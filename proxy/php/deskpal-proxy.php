<?php
/**
 * deskpal reference proxy for PHP 8.1+ (curl), a port of ../node/deskpal-proxy.mjs.
 *
 * The page never holds an API key: the widget calls these routes on your own
 * server, which add the key, fix the model and limits, and refuse misuse.
 *
 *   POST …/embed                  question vectors for `embedEndpoint`
 *   POST …/llm/chat/completions   OpenAI-compatible writer (`openai-compatible`)
 *   POST …/claude                 Claude Messages API writer (`anthropic`)
 *
 * Routes match by suffix: put this file at /api/deskpal.php and call
 * /api/deskpal.php/embed, or rewrite /api/deskpal/* to it. Settings come from
 * environment variables (see ../README.md).
 *
 * PHP can't run the embedding model itself on most hosts, so `/embed` checks
 * and limits the request here, then asks the Node or Python proxy running
 * next to it (EMBED_URL, such as http://127.0.0.1:8789/embed).
 *
 * Each request is its own PHP process, so the limits are kept in a small JSON
 * file (DESKPAL_STATE_DIR, default the system temp folder), locked while
 * updated.
 */

declare(strict_types=1);

const ANTHROPIC_VERSION = '2026-10-21';
const ANTHROPIC_BETAS = ['server-side-fallback-2026-07-01'];
const MAX_TEXTS = 32;
const MAX_TEXT_CHARS = 1000;
const MAX_MESSAGES = 20;
const MAX_BODY = 64000;

function env(string $key, ?string $default = null): ?string
{
    $v = getenv($key);
    return $v === false || $v === '' ? $default : $v;
}

/** Settings from environment variables; every one has a default. */
function config(): array
{
    $n = fn (string $k, float $d): float => (float) env($k, (string) $d);
    return [
        'openai' => env('OPENAI_API_KEY') !== null || env('OPENAI_BASE_URL') !== null ? [
            'key' => env('OPENAI_API_KEY', ''),
            'base_url' => rtrim(env('OPENAI_BASE_URL', 'https://api.openai.com/v1'), '/'),
            'model' => env('OPENAI_MODEL', 'gpt-5-mini'),
            'max_tokens' => (int) $n('OPENAI_MAX_TOKENS', 2000),
        ] : null,
        'anthropic' => env('ANTHROPIC_API_KEY') !== null ? [
            'key' => env('ANTHROPIC_API_KEY'),
            'base_url' => rtrim(env('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'), '/'),
            'model' => env('CLAUDE_MODEL', 'claude-opus-5-5'),
            'max_tokens' => (int) $n('CLAUDE_MAX_TOKENS', 1024),
        ] : null,
        'embed_url' => env('EMBED_URL'),
        'allowed_origins' => env('ALLOWED_ORIGINS') !== null ? array_map('trim', explode(',', env('ALLOWED_ORIGINS'))) : null,
        'trust_proxy' => env('TRUST_PROXY') === '1',
        'limits' => [
            'embed_per_minute' => $n('LIMIT_EMBED_PER_MIN', 20),
            'llm_per_minute' => $n('LIMIT_LLM_PER_MIN', 4),
            'llm_per_day' => $n('LIMIT_LLM_PER_DAY', 60),
            'site_llm_per_day' => $n('LIMIT_SITE_LLM_PER_DAY', 1000),
        ],
    ];
}

function send(int $status, array $body, array $headers = []): void
{
    http_response_code($status);
    header('content-type: application/json');
    header('cache-control: no-store');
    foreach ($headers as $h) header($h);
    echo json_encode($body);
}

function too_many(int $wait): void
{
    send(429, ['error' => 'too many requests'], ["retry-after: $wait"]);
}

// ---- limits ----------------------------------------------------------------

/** Runs $fn on the shared limits state, locked against other requests. */
function with_state(callable $fn)
{
    $file = rtrim(env('DESKPAL_STATE_DIR', sys_get_temp_dir()), '/') . '/deskpal-proxy-limits.json';
    $h = fopen($file, 'c+');
    flock($h, LOCK_EX);
    try {
        $state = json_decode(stream_get_contents($h) ?: '{}', true) ?: [];
        $state += ['buckets' => [], 'site' => ['day' => '', 'count' => 0], 'streaming' => []];
        $result = $fn($state);
        ftruncate($h, 0);
        rewind($h);
        fwrite($h, json_encode($state));
        return $result;
    } finally {
        flock($h, LOCK_UN);
        fclose($h);
    }
}

function today(): string
{
    return gmdate('Y-m-d');
}

function seconds_to_midnight(): int
{
    return 86400 - (time() % 86400);
}

/** Takes a token from the visitor's bucket, or returns the seconds to wait. */
function take(array &$state, array $limits, string $kind, string $ip): int
{
    $perMinute = $kind === 'embed' ? $limits['embed_per_minute'] : $limits['llm_per_minute'];
    $perDay = $kind === 'embed' ? 0 : $limits['llm_per_day'];
    $now = microtime(true);
    // Forget visitors idle for an hour, so the file doesn't grow without end.
    if (count($state['buckets']) > 5000) {
        $state['buckets'] = array_filter($state['buckets'], fn ($b) => $now - $b['at'] < 3600);
    }
    $key = "$kind $ip";
    $b = $state['buckets'][$key] ?? ['tokens' => $perMinute, 'at' => $now, 'day' => today(), 'used' => 0];
    $b['tokens'] = min($perMinute, $b['tokens'] + ($now - $b['at']) / 60 * $perMinute);
    $b['at'] = $now;
    if ($b['day'] !== today()) {
        $b['day'] = today();
        $b['used'] = 0;
    }
    $wait = 0;
    if ($perDay && $b['used'] >= $perDay) {
        $wait = seconds_to_midnight();
    } elseif ($b['tokens'] < 1) {
        $wait = max(1, (int) ceil((1 - $b['tokens']) / $perMinute * 60));
    } else {
        $b['tokens'] -= 1;
        $b['used'] += 1;
    }
    $state['buckets'][$key] = $b;
    return $wait;
}

function take_site(array &$state, array $limits): int
{
    if ($state['site']['day'] !== today()) $state['site'] = ['day' => today(), 'count' => 0];
    if ($state['site']['count'] >= $limits['site_llm_per_day']) return seconds_to_midnight();
    $state['site']['count']++;
    return 0;
}

// ---- requests --------------------------------------------------------------

/** Pages on other sites can't spend your budget: their Origin isn't yours. */
function same_site(?array $allowed): bool
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
    if (!$origin) return true; // not a browser page: the rate limits apply
    if ($allowed) return in_array($origin, $allowed, true);
    $host = parse_url($origin, PHP_URL_HOST);
    $port = parse_url($origin, PHP_URL_PORT);
    return ($port ? "$host:$port" : $host) === ($_SERVER['HTTP_HOST'] ?? '');
}

/** The socket's address; behind your own reverse proxy, the last X-Forwarded-For hop it added. */
function client_ip(bool $trustProxy): string
{
    if ($trustProxy && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $hops = array_values(array_filter(array_map('trim', explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']))));
        if ($hops) return end($hops);
    }
    return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
}

function valid_messages($messages, array $roles): bool
{
    if (!is_array($messages) || !array_is_list($messages) || !$messages || count($messages) > MAX_MESSAGES) return false;
    foreach ($messages as $m) {
        if (!is_array($m) || !in_array($m['role'] ?? null, $roles, true) || !is_string($m['content'] ?? null)) return false;
    }
    return true;
}

function only_role_and_content(array $messages): array
{
    return array_map(fn ($m) => ['role' => $m['role'], 'content' => $m['content']], $messages);
}

/** Only the messages pass through; the model and the length cap are the server's. */
function openai_request(array $cfg, $body): ?array
{
    if (!is_array($body) || !valid_messages($body['messages'] ?? null, ['system', 'user', 'assistant'])) return null;
    // OpenAI's own API wants max_completion_tokens; other servers (Ollama, vLLM) max_tokens.
    $capField = str_contains($cfg['base_url'], 'api.openai.com') ? 'max_completion_tokens' : 'max_tokens';
    $headers = ['content-type: application/json'];
    if ($cfg['key'] !== '') $headers[] = "authorization: Bearer {$cfg['key']}";
    return [
        'url' => "{$cfg['base_url']}/chat/completions",
        'headers' => $headers,
        'body' => ['model' => $cfg['model'], 'messages' => only_role_and_content($body['messages']), 'stream' => true, $capField => $cfg['max_tokens']],
    ];
}

/** The widget's Messages API request, with the server's model and cap, and only the fields it uses. */
function claude_request(array $cfg, $body): ?array
{
    if (!is_array($body) || !valid_messages($body['messages'] ?? null, ['user', 'assistant'])) return null;
    if (isset($body['system']) && !is_string($body['system'])) return null;
    $asked = is_numeric($body['max_tokens'] ?? null) ? (int) $body['max_tokens'] : $cfg['max_tokens'];
    $out = [
        'model' => $cfg['model'],
        'max_tokens' => max(1, min($asked, $cfg['max_tokens'])),
        'stream' => true,
        'messages' => only_role_and_content($body['messages']),
    ];
    if (!empty($body['system'])) $out['system'] = $body['system'];
    $effort = is_array($body['output_config'] ?? null) ? ($body['output_config']['effort'] ?? null) : null;
    if (in_array($effort, ['low', 'medium', 'high'], true)) $out['output_config'] = ['effort' => $effort];
    if (($body['fallbacks'] ?? null) === 'default') $out['fallbacks'] = 'default';
    $version = $_SERVER['HTTP_ANTHROPIC_VERSION'] ?? '';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $version)) $version = ANTHROPIC_VERSION;
    $betas = array_values(array_intersect(array_map('trim', explode(',', $_SERVER['HTTP_ANTHROPIC_BETA'] ?? '')), ANTHROPIC_BETAS));
    $headers = ['content-type: application/json', "x-api-key: {$cfg['key']}", "anthropic-version: $version"];
    if ($betas) $headers[] = 'anthropic-beta: ' . implode(',', $betas);
    return ['url' => "{$cfg['base_url']}/v1/messages", 'headers' => $headers, 'body' => $out];
}

/**
 * Streams the upstream reply to the visitor as it arrives. When the visitor
 * leaves, the next write notices and the upstream call is cut off.
 */
function stream_upstream(array $up): void
{
    ignore_user_abort(true);
    while (ob_get_level()) ob_end_flush();
    header('x-accel-buffering: no'); // nginx: don't hold the stream back
    $status = 0;
    $type = 'text/event-stream';
    $started = false;
    $ch = curl_init($up['url']);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($up['body']),
        CURLOPT_HTTPHEADER => $up['headers'],
        CURLOPT_TIMEOUT => 120,
        CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$status, &$type) {
            if (preg_match('#^HTTP/\S+ (\d+)#', $line, $m)) $status = (int) $m[1];
            if (stripos($line, 'content-type:') === 0) $type = trim(substr($line, 13));
            return strlen($line);
        },
        CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$status, &$type, &$started) {
            if (!$started) {
                $started = true;
                http_response_code($status ?: 502);
                header("content-type: $type");
                header('cache-control: no-store');
            }
            echo $chunk;
            flush();
            return connection_aborted() ? 0 : strlen($chunk);
        },
    ]);
    $ok = curl_exec($ch);
    if (!$started) {
        if ($ok === false) send(502, ['error' => 'upstream failed']);
        else {
            http_response_code($status ?: 502);
            header('cache-control: no-store');
        }
    }
    curl_close($ch);
}

function forward_embed(string $url, array $texts): void
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode(['texts' => $texts]),
        CURLOPT_HTTPHEADER => ['content-type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
    ]);
    $reply = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($reply === false || $status !== 200) {
        send(502, ['error' => 'embedding service failed']);
        return;
    }
    http_response_code(200);
    header('content-type: application/json');
    header('cache-control: no-store');
    echo $reply;
}

// ---- the router ------------------------------------------------------------

function handle(): void
{
    $config = config();
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
    $route = str_ends_with($path, '/embed') ? 'embed'
        : (str_ends_with($path, '/llm/chat/completions') ? 'openai'
        : (preg_match('#/claude(/v1/messages)?$#', $path) ? 'claude' : null));
    if (!$route) {
        send(404, ['error' => 'not found']);
        return;
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        send(405, ['error' => 'POST only']);
        return;
    }
    if (!same_site($config['allowed_origins'])) {
        send(403, ['error' => 'cross-site request']);
        return;
    }
    if (($route === 'embed' && !$config['embed_url']) || ($route === 'openai' && !$config['openai']) || ($route === 'claude' && !$config['anthropic'])) {
        send(404, ['error' => 'not enabled']);
        return;
    }
    $ip = client_ip($config['trust_proxy']);
    $raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
    if (strlen((string) $raw) > MAX_BODY) {
        send(413, ['error' => 'too large']);
        return;
    }
    $body = json_decode((string) $raw, true);
    $limits = $config['limits'];

    if ($route === 'embed') {
        $texts = is_array($body) ? ($body['texts'] ?? null) : null;
        if (!is_array($texts) || !array_is_list($texts) || !$texts || count($texts) > MAX_TEXTS || array_filter($texts, fn ($t) => !is_string($t))) {
            send(400, ['error' => 'bad request']);
            return;
        }
        $wait = with_state(fn (&$s) => take($s, $limits, 'embed', $ip));
        if ($wait) {
            too_many($wait);
            return;
        }
        forward_embed($config['embed_url'], array_map(fn ($t) => mb_substr($t, 0, MAX_TEXT_CHARS), $texts));
        return;
    }

    $up = $route === 'openai' ? openai_request($config['openai'], $body) : claude_request($config['anthropic'], $body);
    if (!$up) {
        send(400, ['error' => 'bad request']);
        return;
    }
    // One answer at a time per visitor, then the visitor's and the site's budgets.
    $wait = with_state(function (&$s) use ($limits, $ip) {
        // A crashed request can't hold a visitor's slot for more than two minutes.
        if (isset($s['streaming'][$ip]) && time() - $s['streaming'][$ip] < 130) return 5;
        $wait = take($s, $limits, 'llm', $ip) ?: take_site($s, $limits);
        if (!$wait) $s['streaming'][$ip] = time();
        return $wait;
    });
    if ($wait) {
        too_many($wait);
        return;
    }
    try {
        stream_upstream($up);
    } finally {
        with_state(function (&$s) use ($ip) {
            unset($s['streaming'][$ip]);
        });
    }
}

handle();
