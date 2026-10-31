// One behaviour, three ports: runs the same checks against the Node, Python or
// PHP proxy, with a fake OpenAI/Anthropic server upstream (no keys, no cost).
//
//   node proxy/test/conformance.mjs node|python|php [--embed]
//
// --embed also checks question embeddings against transformers.js, which
// downloads bge-small (34 MB) once. PHP hands embedding to a Node sidecar.
// PYTHON and PHP pick the interpreters.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, after } from 'node:test';
import { fileURLToPath } from 'node:url';

const port = process.argv[2];
const withEmbed = process.argv.includes('--embed');
const DIR = fileURLToPath(new URL('..', import.meta.url));
const COMMANDS = {
  node: (p) => [process.execPath, [`${DIR}node/deskpal-proxy.mjs`], {}],
  python: (p) => [process.env.PYTHON ?? 'python3', [`${DIR}python/deskpal_proxy.py`], {}],
  // The built-in server runs one request at a time unless given workers.
  // Limits live in a state file: a fresh folder per instance.
  php: (p) => [process.env.PHP ?? 'php', ['-S', `127.0.0.1:${p}`, `${DIR}php/deskpal-proxy.php`], { PHP_CLI_SERVER_WORKERS: '4', DESKPAL_STATE_DIR: mkdtempSync(join(tmpdir(), 'deskpal-php-')) }],
};
if (!COMMANDS[port]) {
  console.error('usage: node proxy/test/conformance.mjs node|python|php [--embed]');
  process.exit(2);
}

// ---- the fake upstream ----------------------------------------------------

const seen = [];
let closedEarly = 0;
const upstream = createServer(async (req, res) => {
  let text = '';
  for await (const c of req) text += c;
  const body = JSON.parse(text);
  seen.push({ path: req.url, headers: req.headers, body });
  const slow = JSON.stringify(body).includes('SLOW');
  res.on('close', () => {
    if (!res.writableEnded) closedEarly++;
  });
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const pieces = ['Hel', 'lo', '!'];
  for (const p of pieces) {
    if (res.destroyed) return;
    res.write(req.url.endsWith('/messages')
      ? `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: p } })}\n\n`
      : `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`);
    await new Promise((r) => setTimeout(r, slow ? 1500 : 5));
  }
  res.end(req.url.endsWith('/messages') ? '' : 'data: [DONE]\n\n');
});
upstream.listen(0, '127.0.0.1');
await once(upstream, 'listening');
const UP = `http://127.0.0.1:${upstream.address().port}`;

// ---- proxies under test ---------------------------------------------------

const procs = [];
async function start(env, which = port) {
  const p = 18000 + Math.floor(Math.random() * 2000);
  const [cmd, args, extra] = COMMANDS[which](p);
  const child = spawn(cmd, args, {
    env: { ...process.env, PORT: String(p), OPENAI_API_KEY: 'test-openai', OPENAI_BASE_URL: `${UP}/v1`, OPENAI_MODEL: 'server-model', ANTHROPIC_API_KEY: 'test-claude', ANTHROPIC_BASE_URL: UP, CLAUDE_MODEL: 'claude-server', CLAUDE_MAX_TOKENS: '500', TRUST_PROXY: '1', EMBED_MODEL: withEmbed ? 'bge-small-en-v1.5' : 'off', ...extra, ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  procs.push(child);
  const base = `http://127.0.0.1:${p}/api/deskpal`;
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${base}/embed`, { method: 'GET' });
      return base;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`${which} proxy did not start`);
}
after(() => {
  for (const p of procs) p.kill();
  upstream.close();
});

// PHP's /embed forwards to a Node proxy that only embeds, with its own limit out of the way.
const sidecar = port === 'php' && withEmbed ? await start({ OPENAI_API_KEY: '', OPENAI_BASE_URL: '', ANTHROPIC_API_KEY: '', LIMIT_EMBED_PER_MIN: '1000' }, 'node') : null;
const base = await start({ LIMIT_LLM_PER_MIN: '3', LIMIT_EMBED_PER_MIN: '5', ...(sidecar ? { EMBED_URL: `${sidecar}/embed` } : {}) });
const chat = (ip, body, headers = {}) =>
  fetch(`${base}/llm/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.9, ${ip}`, ...headers }, body: JSON.stringify(body) });
const claude = (ip, body, headers = {}) =>
  fetch(`${base}/claude`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, 'anthropic-version': '2026-10-21', ...headers }, body: JSON.stringify(body) });
const ask = (q) => ({ model: 'gpt-anything', messages: [{ role: 'system', content: 'Use the sources.' }, { role: 'user', content: q, name: 'extra field' }] });

test('openai: streams the reply; the server picks the model, the cap and the key', async () => {
  const res = await chat('1.1.1.1', ask('hello?'));
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /"content":"Hel"/);
  assert.match(text, /\[DONE\]/);
  const up = seen.at(-1);
  assert.equal(up.path, '/v1/chat/completions');
  assert.equal(up.body.model, 'server-model');
  assert.equal(up.body.stream, true);
  assert.equal(up.body.max_tokens, 2000, 'max_tokens for servers other than api.openai.com');
  assert.deepEqual(up.body.messages[1], { role: 'user', content: 'hello?' }, 'only role and content pass through');
  assert.equal(up.headers.authorization, 'Bearer test-openai');
});

test('openai: refuses malformed, oversized, cross-site and non-POST requests', async () => {
  assert.equal((await chat('1.1.1.2', { messages: [{ role: 'tool', content: 'x' }] })).status, 400);
  assert.equal((await chat('1.1.1.2', { messages: [] })).status, 400);
  assert.equal((await chat('1.1.1.2', { messages: Array(21).fill({ role: 'user', content: 'x' }) })).status, 400);
  assert.equal((await chat('1.1.1.2', ask('x'.repeat(70_000)))).status, 413);
  assert.equal((await chat('1.1.1.2', ask('hi'), { origin: 'https://evil.example' })).status, 403);
  assert.equal((await fetch(`${base}/llm/chat/completions`)).status, 405);
  assert.equal((await fetch(`${base}/nothing-here`, { method: 'POST' })).status, 404);
});

test('claude: the server picks the model and caps the length; only known options pass', async () => {
  const res = await claude('2.2.2.2', {
    model: 'claude-client', max_tokens: 4000, stream: true, system: 'Use the sources.', messages: [{ role: 'user', content: 'hi' }],
    output_config: { effort: 'low' }, fallbacks: 'default', tools: [{ name: 'evil' }],
  }, { 'anthropic-beta': 'server-side-fallback-2026-07-01, some-other-beta' });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /text_delta/);
  const up = seen.at(-1);
  assert.equal(up.path, '/v1/messages');
  assert.equal(up.body.model, 'claude-server');
  assert.equal(up.body.max_tokens, 500);
  assert.equal(up.body.system, 'Use the sources.');
  assert.deepEqual(up.body.output_config, { effort: 'low' });
  assert.equal(up.body.fallbacks, 'default');
  assert.equal(up.body.tools, undefined);
  assert.equal(up.headers['x-api-key'], 'test-claude');
  assert.equal(up.headers['anthropic-version'], '2026-10-21');
  assert.equal(up.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal((await claude('2.2.2.3', { messages: [{ role: 'system', content: 'x' }] })).status, 400);
});

test('limits: a visitor gets a burst, then 429 with Retry-After; others are unaffected', async () => {
  // Each answer read to the end, as the widget does, before the next.
  for (let i = 0; i < 3; i++) {
    const res = await chat('3.3.3.3', ask('q'));
    assert.equal(res.status, 200);
    await res.text();
  }
  const res = await chat('3.3.3.3', ask('q'));
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get('retry-after')) >= 1);
  assert.equal((await chat('3.3.3.4', ask('q'))).status, 200);
});

test('limits: one answer at a time per visitor; leaving stops the upstream call', async () => {
  const first = await chat('4.4.4.4', ask('SLOW'), {});
  const reader = first.body.getReader();
  await reader.read();
  assert.equal((await chat('4.4.4.4', ask('again'))).status, 429, 'second answer while the first streams');
  await reader.cancel();
  const before = closedEarly;
  for (let i = 0; i < 40 && closedEarly === before; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(closedEarly, before + 1, 'upstream stream closed when the visitor left');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await chat('4.4.4.4', ask('later'))).status, 200, 'free again afterwards');
});

test('limits: a daily cap for the whole site', async () => {
  const capped = await start({ LIMIT_SITE_LLM_PER_DAY: '2', EMBED_MODEL: 'off' });
  const go = async (ip) => {
    const res = await fetch(`${capped}/llm/chat/completions`, { method: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify(ask('q')) });
    await res.text();
    return res.status;
  };
  assert.equal(await go('5.5.5.1'), 200);
  assert.equal(await go('5.5.5.2'), 200);
  assert.equal(await go('5.5.5.3'), 429);
});

test('embed: off unless enabled', { skip: withEmbed }, async () => {
  assert.equal((await fetch(`${base}/embed`, { method: 'POST', body: '{"texts":["hi"]}' })).status, 404);
});

test('embed: vectors match the widget\'s own (transformers.js), and are limited', { skip: !withEmbed, timeout: 300_000 }, async () => {
  const texts = ['how much does it cost?', 'can I block out my holidays', 'hello'];
  const res = await fetch(`${base}/embed`, { method: 'POST', headers: { 'x-forwarded-for': '6.6.6.6' }, body: JSON.stringify({ texts }) });
  assert.equal(res.status, 200);
  const { model, vectors } = await res.json();
  assert.equal(model, 'Xenova/bge-small-en-v1.5');
  assert.equal(vectors.length, 3);
  assert.equal(vectors[0].length, 384);
  const { pipeline } = await import('@huggingface/transformers');
  const ex = await pipeline('feature-extraction', model, { dtype: 'q8' });
  const ref = await ex(texts.map((t) => `Represent this sentence for searching relevant passages: ${t}`), { pooling: 'cls', normalize: true });
  vectors.forEach((v, i) => {
    const cos = v.reduce((a, x, j) => a + x * ref.data[i * 384 + j], 0);
    assert.ok(cos > 0.999, `"${texts[i]}": cosine ${cos} to the widget's vector`);
  });
  const bad = (body) => fetch(`${base}/embed`, { method: 'POST', headers: { 'x-forwarded-for': '6.6.6.7' }, body });
  assert.equal((await bad('{"texts":[]}')).status, 400);
  assert.equal((await bad(JSON.stringify({ texts: Array(33).fill('x') }))).status, 400);
  assert.equal((await bad('{"texts":[1]}')).status, 400);
  // 5 a minute: one used above for 6.6.6.6, so four more, then 429.
  for (let i = 0; i < 4; i++) assert.equal((await fetch(`${base}/embed`, { method: 'POST', headers: { 'x-forwarded-for': '6.6.6.6' }, body: '{"texts":["hi"]}' })).status, 200);
  assert.equal((await fetch(`${base}/embed`, { method: 'POST', headers: { 'x-forwarded-for': '6.6.6.6' }, body: '{"texts":["hi"]}' })).status, 429);
});

test('claude: the full Messages path works too', async () => {
  const res = await fetch(`${base}/claude/v1/messages`, { method: 'POST', headers: { 'x-forwarded-for': '2.2.2.9' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
  assert.equal(res.status, 200);
  await res.text();
  assert.equal(seen.at(-1).path, '/v1/messages');
});

test('limits: a daily cap per visitor', async () => {
  const daily = await start({ LIMIT_LLM_PER_DAY: '2', EMBED_MODEL: 'off' });
  const go = async (ip) => {
    const res = await fetch(`${daily}/llm/chat/completions`, { method: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify(ask('q')) });
    await res.text();
    return res.status;
  };
  assert.equal(await go('7.7.7.1'), 200);
  assert.equal(await go('7.7.7.1'), 200);
  assert.equal(await go('7.7.7.1'), 429);
  assert.equal(await go('7.7.7.2'), 200, 'other visitors keep their own allowance');
});

test('origins: ALLOWED_ORIGINS lists the sites whose pages may call it', async () => {
  const listed = await start({ ALLOWED_ORIGINS: 'https://docs.example, https://help.example', EMBED_MODEL: 'off' });
  const from = async (origin) => {
    const res = await fetch(`${listed}/llm/chat/completions`, { method: 'POST', headers: { origin, 'x-forwarded-for': `8.8.${origin.length}.1` }, body: JSON.stringify(ask('q')) });
    await res.text();
    return res.status;
  };
  assert.equal(await from('https://docs.example'), 200);
  assert.equal(await from('https://help.example'), 200);
  assert.equal(await from('https://evil.example'), 403);
  assert.equal(await from('http://docs.example'), 403, 'the scheme counts');
});

test('visitors: without TRUST_PROXY, X-Forwarded-For is ignored', async () => {
  const direct = await start({ TRUST_PROXY: '', LIMIT_LLM_PER_DAY: '1', EMBED_MODEL: 'off' });
  const go = async (ip) => {
    const res = await fetch(`${direct}/llm/chat/completions`, { method: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify(ask('q')) });
    await res.text();
    return res.status;
  };
  assert.equal(await go('9.9.9.1'), 200);
  assert.equal(await go('9.9.9.2'), 429, 'a made-up address does not get a fresh allowance');
});

// PHP has no queue of its own: its workers wait on the sidecar, which is tested as Node.
test('embed: while one runs, a full queue answers 503 and answers still stream', { skip: !withEmbed || port === 'php', timeout: 300_000 }, async () => {
  const busy = await start({ LIMIT_EMBED_PER_MIN: '1000', EMBED_QUEUE: '1' });
  const embed = (ip, texts) => fetch(`${busy}/embed`, { method: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify({ texts }) });
  await (await embed('10.1.0.1', ['warm up'])).arrayBuffer();
  // The largest batch allowed keeps the model busy for a few seconds even on fast CPUs.
  const heavy = embed('10.1.0.2', Array.from({ length: 32 }, (_, j) => `question ${j} `.repeat(100).slice(0, 1000)));
  await new Promise((r) => setTimeout(r, 100));

  const started = Date.now();
  const refused = await embed('10.1.0.3', ['one more']);
  assert.equal(refused.status, 503);
  assert.ok(Number(refused.headers.get('retry-after')) >= 1);
  const answer = await fetch(`${busy}/llm/chat/completions`, { method: 'POST', headers: { 'x-forwarded-for': '10.1.0.4' }, body: JSON.stringify(ask('q')) });
  assert.equal(answer.status, 200);
  assert.match(await answer.text(), /\[DONE\]/);
  assert.ok(Date.now() - started < 2000, `other requests waited ${Date.now() - started} ms for the model`);

  const done = await heavy;
  assert.equal(done.status, 200, 'the running one still finishes');
  assert.equal((await done.json()).vectors.length, 32);
});
