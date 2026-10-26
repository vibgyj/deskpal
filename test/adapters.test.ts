import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AnthropicAdapter, RefusalError } from '../src/adapters/anthropic.ts';
import { CustomAdapter } from '../src/adapters/custom.ts';
import { createGenerativeAdapter } from '../src/adapters/index.ts';
import { OpenAICompatibleAdapter } from '../src/adapters/openai-compatible.ts';
import { resolveConfig, sanitize } from '../src/core/config.ts';
import type { Prompt } from '../src/rag/prompt.ts';
import { sseData } from '../src/adapters/sse.ts';

function stream(parts: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(enc.encode(p));
      c.close();
    },
  });
}

const prompt = (question = 'hi'): Prompt => ({
  messages: [
    { role: 'system', content: 'Answer from the sources.\n\n[1] Setup\nRun it.' },
    { role: 'user', content: question },
  ],
  question,
  sources: [{ title: 'Setup', url: '/docs/setup', text: 'Run it.' }],
});
const never = () => new AbortController().signal;

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

test('sse parser handles split lines, CRLF and multi-line data', async () => {
  const got = await collect(sseData(stream(['data: {"a"', ':1}\r\n\r\n: comment\n', 'data: one\ndata: two\n\n', 'data: [DONE]\n\n'])));
  assert.deepEqual(got, ['{"a":1}', 'one\ntwo', '[DONE]']);
});

test('openai-compatible adapter streams deltas and posts the prompt', async (t) => {
  let request: { url: string; body: any; headers: any } | undefined;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    request = { url, body: JSON.parse(init.body as string), headers: init.headers };
    const chunk = (s: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: s } }] })}\n\n`;
    return new Response(stream([chunk('Hel'), chunk('lo [1]'), 'data: {"choices":[{"delta":{}}]}\n\n', 'data: [DONE]\n\n']));
  });
  const a = new OpenAICompatibleAdapter({ endpoint: 'http://localhost:11434/v1/', model: 'qwen', apiKey: 'k' });
  const pieces = await collect(a.generate(prompt(), never()));
  assert.deepEqual(pieces, ['Hel', 'lo [1]']);
  assert.equal(request!.url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(request!.body.model, 'qwen');
  assert.equal(request!.body.stream, true);
  assert.equal(request!.headers.authorization, 'Bearer k');
});

test('openai-compatible adapter surfaces HTTP errors', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 500 }));
  const a = new OpenAICompatibleAdapter({ endpoint: 'http://x/v1/chat/completions', model: 'm' });
  await assert.rejects(collect(a.generate(prompt(), never())), /answered 500/);
});

/** A Messages API stream: each event as `event:` + `data:`, the way the API sends them. */
function claudeStream(events: object[]): Response {
  return new Response(stream(events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)), {
    headers: { 'content-type': 'text/event-stream' },
  });
}
const text = (t: string) => ({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: t } });

test('anthropic adapter: posts a Messages request and streams only the answer text', async (t) => {
  let request: { url: string; body: any; headers: any } | undefined;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    request = { url, body: JSON.parse(init.body as string), headers: init.headers };
    return claudeStream([
      { type: 'message_start', message: { id: 'msg_1', model: 'claude-opus-5-5', content: [] } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      text('Run '),
      text('it [1].'),
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } },
      { type: 'message_stop' },
    ]);
  });
  const a = new AnthropicAdapter({ endpoint: 'https://site.test/api/claude/v1/' });
  assert.deepEqual(await collect(a.generate(prompt('How?'), never())), ['Run ', 'it [1].']);
  assert.equal(request!.url, 'https://site.test/api/claude/v1/messages');
  assert.equal(request!.headers['anthropic-version'], '2026-10-21');
  assert.equal(request!.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(request!.headers['x-api-key'], undefined, 'the key is added by the proxy, never the page');
  assert.deepEqual(request!.body, {
    model: 'claude-opus-5-5',
    max_tokens: 1024,
    stream: true,
    system: 'Answer from the sources.\n\n[1] Setup\nRun it.',
    messages: [{ role: 'user', content: 'How?' }],
    output_config: { effort: 'low' },
    fallbacks: 'default',
  });
});

test('anthropic adapter: fallbacks and effort only for models that take them', async (t) => {
  const bodies: any[] = [];
  const headers: any[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string));
    headers.push(init.headers);
    return claudeStream([text('ok'), { type: 'message_stop' }]);
  });
  await collect(new AnthropicAdapter({ endpoint: '/claude', model: 'claude-haiku-5-5' }).generate(prompt(), never()));
  await collect(new AnthropicAdapter({ endpoint: '/claude', model: 'claude-haiku-4-5' }).generate(prompt(), never()));
  assert.deepEqual(bodies[0].output_config, { effort: 'low' });
  assert.equal(bodies[0].fallbacks, undefined);
  assert.equal(headers[0]['anthropic-beta'], undefined);
  assert.equal(bodies[1].output_config, undefined);
});

test('anthropic adapter: a refusal or stream error throws, so the widget discards the partial answer', async (t) => {
  const responses = [
    [text('Part'), { type: 'message_delta', delta: { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } } }],
    [text('Part'), { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }],
  ];
  t.mock.method(globalThis, 'fetch', async () => claudeStream(responses.shift()!));
  const a = new AnthropicAdapter({ endpoint: '/claude' });
  await assert.rejects(collect(a.generate(prompt(), never())), (e: unknown) => e instanceof RefusalError && e.category === 'cyber');
  await assert.rejects(collect(a.generate(prompt(), never())), /overloaded_error/);
});

test('anthropic adapter: HTTP errors name the API error type', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, { status: 429 }));
  await assert.rejects(collect(new AnthropicAdapter({ endpoint: '/claude' }).generate(prompt(), never())), /answered 429 \(rate_limit_error\)/);
});

test('custom adapter: accepts a stream, a promise or plain text, and gets the sources', async () => {
  const seen: Prompt[] = [];
  const streamed = new CustomAdapter(async function* (p) {
    seen.push(p);
    yield 'Run ';
    yield '';
    yield 'it.';
  });
  assert.deepEqual(await collect(streamed.generate(prompt('How?'), never())), ['Run ', 'it.']);
  assert.equal(seen[0]!.question, 'How?');
  assert.deepEqual(seen[0]!.sources, [{ title: 'Setup', url: '/docs/setup', text: 'Run it.' }]);
  assert.deepEqual(await collect(new CustomAdapter(async () => 'All at once.').generate(prompt(), never())), ['All at once.']);
  assert.deepEqual(await collect(new CustomAdapter(() => 'Sync.').generate(prompt(), never())), ['Sync.']);
  await assert.rejects(collect(new CustomAdapter((async () => 42) as never).generate(prompt(), never())), /must return text/);
});

test('custom adapter: stops reading when the question is abandoned', async () => {
  const ctrl = new AbortController();
  const a = new CustomAdapter(async function* () {
    yield 'one';
    ctrl.abort();
    yield 'two';
  });
  assert.deepEqual(await collect(a.generate(prompt(), ctrl.signal)), ['one']);
});

test('writers are created from config, and misconfigured ones fall back to snippets', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const generate = async () => 'x';
  assert.ok(createGenerativeAdapter(resolveConfig({ adapter: 'anthropic', endpoint: '/claude' })) instanceof AnthropicAdapter);
  assert.ok(createGenerativeAdapter(resolveConfig({ adapter: 'custom', generate })) instanceof CustomAdapter);
  assert.equal(createGenerativeAdapter(resolveConfig({ adapter: 'anthropic' })), null);
  assert.equal(createGenerativeAdapter(resolveConfig({ adapter: 'custom' })), null);
  assert.equal(createGenerativeAdapter(resolveConfig({ adapter: 'browser' })), null);
  assert.equal(warn.mock.callCount(), 2);
  // A function can't come from a data attribute or JSON, only from init().
  assert.equal(sanitize({ generate: 'alert(1)' }).generate, undefined);
  assert.equal(sanitize({ adapter: 'anthropic' }).adapter, 'anthropic');
});
