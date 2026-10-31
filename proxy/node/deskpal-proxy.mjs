// deskpal reference proxy for Node (22.18+). The page never holds an API key:
// the widget calls these routes on your own server, which add the key, fix the
// model and limits, and refuse misuse. Ports with the same behaviour:
// ../python/deskpal_proxy.py and ../php/deskpal-proxy.php (see ../README.md).
//
//   POST …/embed                  question vectors for `embedEndpoint`
//   POST …/llm/chat/completions   OpenAI-compatible writer (`openai-compatible`)
//   POST …/claude                 Claude Messages API writer (`anthropic`)
//
// Routes match by suffix, so mount them under any path (/api/deskpal/embed…).
// Run it alone (`node deskpal-proxy.mjs`, configured by environment variables)
// or use `createProxy()` as a handler inside your own server.
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

/** Models an index can be built with (`deskpal build-index --model`). */
export const EMBED_MODELS = {
  'bge-small-en-v1.5': { id: 'Xenova/bge-small-en-v1.5', dim: 384 },
  'bge-base-en-v1.5': { id: 'Xenova/bge-base-en-v1.5', dim: 768 },
};
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
const ANTHROPIC_VERSION = '2026-10-21';
const ANTHROPIC_BETAS = new Set(['server-side-fallback-2026-07-01']);

const MAX_TEXTS = 32;
const MAX_TEXT_CHARS = 1000;
const MAX_MESSAGES = 20;
const MAX_BODY = 64_000;

/** Settings from environment variables; every one has a default. */
export function configFromEnv(env = process.env) {
  const n = (k, d) => (env[k] ? Number(env[k]) : d);
  return {
    openai: env.OPENAI_API_KEY || env.OPENAI_BASE_URL
      ? { key: env.OPENAI_API_KEY ?? '', baseUrl: (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, ''), model: env.OPENAI_MODEL ?? 'gpt-5-mini', maxTokens: n('OPENAI_MAX_TOKENS', 2000) }
      : null,
    anthropic: env.ANTHROPIC_API_KEY
      ? { key: env.ANTHROPIC_API_KEY, baseUrl: (env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/+$/, ''), model: env.CLAUDE_MODEL ?? 'claude-opus-5-5', maxTokens: n('CLAUDE_MAX_TOKENS', 1024) }
      : null,
    embedModel: env.EMBED_MODEL === 'off' ? null : (env.EMBED_MODEL ?? 'bge-small-en-v1.5'),
    allowedOrigins: env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()) : null,
    trustProxy: env.TRUST_PROXY === '1',
    limits: {
      embedPerMinute: n('LIMIT_EMBED_PER_MIN', 20),
      llmPerMinute: n('LIMIT_LLM_PER_MIN', 4),
      llmPerDay: n('LIMIT_LLM_PER_DAY', 60),
      siteLlmPerDay: n('LIMIT_SITE_LLM_PER_DAY', 1000),
    },
  };
}

/**
 * The proxy as a handler: `(req, res) => Promise<boolean>`, false when the
 * request is not one of its routes, so your server can carry on.
 */
export function createProxy(config = configFromEnv()) {
  const limiter = new Limiter(config.limits);
  const embedder = config.embedModel ? new Embedder(config.embedModel) : null;
  const streaming = new Set();

  return async function handle(req, res) {
    const path = new URL(req.url, 'http://x').pathname;
    const route = path.endsWith('/embed') ? 'embed' : path.endsWith('/llm/chat/completions') ? 'openai' : /\/claude(\/v1\/messages)?$/.test(path) ? 'claude' : null;
    if (!route) return false;
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' }), true;
    if (!sameSite(req, config.allowedOrigins)) return send(res, 403, { error: 'cross-site request' }), true;
    if ((route === 'embed' && !embedder) || (route === 'openai' && !config.openai) || (route === 'claude' && !config.anthropic)) {
      return send(res, 404, { error: 'not enabled' }), true;
    }
    const ip = clientIp(req, config.trustProxy);
    const body = await readJson(req);
    if (body === TOO_BIG) return send(res, 413, { error: 'too large' }), true;

    try {
      if (route === 'embed') {
        const texts = body?.texts;
        if (!Array.isArray(texts) || !texts.length || texts.length > MAX_TEXTS || !texts.every((t) => typeof t === 'string')) return send(res, 400, { error: 'bad request' }), true;
        const wait = limiter.take('embed', ip);
        if (wait) return tooMany(res, wait), true;
        const vectors = await embedder.embed(texts.map((t) => t.slice(0, MAX_TEXT_CHARS)));
        if (!vectors) return send(res, 503, { error: 'busy' }, { 'retry-after': '5' }), true;
        return send(res, 200, { model: embedder.model.id, vectors }), true;
      }

      const upstream = route === 'openai' ? openaiRequest(config.openai, body) : claudeRequest(config.anthropic, body, req.headers);
      if (!upstream) return send(res, 400, { error: 'bad request' }), true;
      // One answer at a time per visitor, then the visitor's and the site's budgets.
      if (streaming.has(ip)) return tooMany(res, 5), true;
      const wait = limiter.take('llm', ip) || limiter.takeSite();
      if (wait) return tooMany(res, wait), true;

      streaming.add(ip);
      const abort = new AbortController();
      // A visitor who closes the page or asks again stops the upstream call too.
      res.on('close', () => {
        streaming.delete(ip);
        abort.abort();
      });
      const up = await fetch(upstream.url, { method: 'POST', headers: upstream.headers, body: JSON.stringify(upstream.body), signal: abort.signal });
      res.writeHead(up.status, { 'content-type': up.headers.get('content-type') ?? 'text/event-stream', 'cache-control': 'no-store' });
      if (up.body) for await (const chunk of up.body) res.write(chunk);
      res.end();
    } catch (err) {
      if (err?.name === 'AbortError') return true;
      console.error('deskpal proxy:', err);
      if (!res.headersSent) send(res, 502, { error: 'upstream failed' });
      else res.end();
    }
    return true;
  };
}

// ---- writers --------------------------------------------------------------

function validMessages(messages, roles) {
  return Array.isArray(messages) && messages.length > 0 && messages.length <= MAX_MESSAGES && messages.every((m) => roles.includes(m?.role) && typeof m.content === 'string');
}

/** Only the messages pass through; the model and the length cap are the server's. */
function openaiRequest(cfg, body) {
  if (!validMessages(body?.messages, ['system', 'user', 'assistant'])) return null;
  const messages = body.messages.map(({ role, content }) => ({ role, content }));
  // OpenAI's own API wants max_completion_tokens; other servers (Ollama, vLLM) max_tokens.
  const cap = cfg.baseUrl.includes('api.openai.com') ? { max_completion_tokens: cfg.maxTokens } : { max_tokens: cfg.maxTokens };
  return {
    url: `${cfg.baseUrl}/chat/completions`,
    headers: { 'content-type': 'application/json', ...(cfg.key ? { authorization: `Bearer ${cfg.key}` } : {}) },
    body: { model: cfg.model, messages, stream: true, ...cap },
  };
}

/** The widget's Messages API request, with the server's model and cap, and only the fields it uses. */
function claudeRequest(cfg, body, headers) {
  if (!validMessages(body?.messages, ['user', 'assistant']) || (body.system !== undefined && typeof body.system !== 'string')) return null;
  const out = {
    model: cfg.model,
    max_tokens: Math.min(Number(body.max_tokens) || cfg.maxTokens, cfg.maxTokens),
    stream: true,
    messages: body.messages.map(({ role, content }) => ({ role, content })),
  };
  if (body.system) out.system = body.system;
  if (['low', 'medium', 'high'].includes(body.output_config?.effort)) out.output_config = { effort: body.output_config.effort };
  if (body.fallbacks === 'default') out.fallbacks = 'default';
  const version = /^\d{4}-\d{2}-\d{2}$/.test(headers['anthropic-version'] ?? '') ? headers['anthropic-version'] : ANTHROPIC_VERSION;
  const betas = String(headers['anthropic-beta'] ?? '').split(',').map((s) => s.trim()).filter((b) => ANTHROPIC_BETAS.has(b));
  return {
    url: `${cfg.baseUrl}/v1/messages`,
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': version, ...(betas.length ? { 'anthropic-beta': betas.join(',') } : {}) },
    body: out,
  };
}

// ---- question embeddings --------------------------------------------------

/** The widget's own code path (transformers.js, q8 ONNX), so vectors match the index exactly. */
class Embedder {
  constructor(name) {
    this.model = EMBED_MODELS[name];
    if (!this.model) throw new Error(`deskpal proxy: unknown EMBED_MODEL "${name}"; choose ${Object.keys(EMBED_MODELS).join(' or ')}`);
    this.extractor = null;
    this.queue = Promise.resolve();
    this.waiting = 0;
    this.cache = new Map();
  }

  /** Vectors for the texts, or null when too many requests are already waiting. */
  async embed(texts) {
    if (this.waiting >= 20) return null;
    this.waiting++;
    // One model call at a time: the CPU is the limit, and a queue keeps memory flat.
    const run = this.queue.then(() => this.run(texts));
    this.queue = run.catch(() => {});
    try {
      return await run;
    } finally {
      this.waiting--;
    }
  }

  async run(texts) {
    if (!this.extractor) {
      const { pipeline } = await import('@huggingface/transformers');
      this.extractor = pipeline('feature-extraction', this.model.id, { dtype: 'q8' });
    }
    const extractor = await this.extractor;
    const missing = [...new Set(texts.filter((t) => !this.cache.has(t)))];
    if (missing.length) {
      const out = await extractor(missing.map((t) => QUERY_PREFIX + t), { pooling: 'cls', normalize: true });
      const dim = out.dims.at(-1);
      missing.forEach((t, i) => this.cache.set(t, Array.from(out.data.slice(i * dim, (i + 1) * dim), round)));
      // Small LRU: common questions and the widget's small-talk examples stay warm.
      while (this.cache.size > 2000) this.cache.delete(this.cache.keys().next().value);
    }
    return texts.map((t) => this.cache.get(t));
  }
}

const round = (x) => Math.round(x * 1e6) / 1e6;

// ---- limits ---------------------------------------------------------------

/** Token buckets per visitor, and a daily count for the whole site. */
class Limiter {
  constructor(limits) {
    this.limits = limits;
    this.buckets = new Map();
    this.site = { day: '', count: 0 };
    // Forget visitors idle for an hour, so the map doesn't grow without end.
    setInterval(() => {
      for (const [k, b] of this.buckets) if (Date.now() - b.at > 3_600_000) this.buckets.delete(k);
    }, 600_000).unref();
  }

  /** Takes a token, or returns the seconds to wait. */
  take(kind, ip) {
    const perMinute = kind === 'embed' ? this.limits.embedPerMinute : this.limits.llmPerMinute;
    const perDay = kind === 'embed' ? 0 : this.limits.llmPerDay;
    const now = Date.now();
    const day = today();
    const key = `${kind} ${ip}`;
    const b = this.buckets.get(key) ?? { tokens: perMinute, at: now, day, used: 0 };
    b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
    b.at = now;
    if (b.day !== day) Object.assign(b, { day, used: 0 });
    this.buckets.set(key, b);
    if (perDay && b.used >= perDay) return secondsToMidnight();
    if (b.tokens < 1) return Math.max(1, Math.ceil(((1 - b.tokens) / perMinute) * 60));
    b.tokens -= 1;
    b.used += 1;
    return 0;
  }

  takeSite() {
    if (this.site.day !== today()) this.site = { day: today(), count: 0 };
    if (this.site.count >= this.limits.siteLlmPerDay) return secondsToMidnight();
    this.site.count++;
    return 0;
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const secondsToMidnight = () => Math.ceil((Date.parse(`${today()}T00:00:00Z`) + 86_400_000 - Date.now()) / 1000);

// ---- HTTP helpers ---------------------------------------------------------

/** Pages on other sites can't spend your budget: their Origin isn't yours. */
function sameSite(req, allowed) {
  const origin = req.headers.origin;
  if (!origin) return true; // not a browser page: the rate limits apply
  if (allowed) return allowed.includes(origin);
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/** The socket's address; behind your own reverse proxy, the last X-Forwarded-For hop it added. */
function clientIp(req, trustProxy) {
  const fwd = trustProxy && String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean).at(-1);
  return fwd || req.socket.remoteAddress || 'unknown';
}

const TOO_BIG = Symbol('too big');

async function readJson(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > MAX_BODY) return TOO_BIG;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function send(res, status, json, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }).end(JSON.stringify(json));
}

function tooMany(res, wait) {
  send(res, 429, { error: 'too many requests' }, { 'retry-after': String(wait) });
}

// Run alone: PORT (default 8788), routes under any path.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const config = configFromEnv();
  const handle = createProxy(config);
  const port = Number(process.env.PORT) || 8788;
  createServer(async (req, res) => {
    if (!(await handle(req, res))) send(res, 404, { error: 'not found' });
  }).listen(port, () => {
    const on = [config.embedModel && `embed (${config.embedModel})`, config.openai && `llm (${config.openai.model})`, config.anthropic && `claude (${config.anthropic.model})`].filter(Boolean);
    console.log(`deskpal proxy on http://localhost:${port}: ${on.join(', ') || 'nothing enabled'}`);
  });
}
