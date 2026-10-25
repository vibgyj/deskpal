import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenAICompatibleAdapter } from '../src/adapters/openai-compatible.ts';
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
  const pieces = await collect(a.generate({ messages: [{ role: 'user', content: 'hi' }] }, new AbortController().signal));
  assert.deepEqual(pieces, ['Hel', 'lo [1]']);
  assert.equal(request!.url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(request!.body.model, 'qwen');
  assert.equal(request!.body.stream, true);
  assert.equal(request!.headers.authorization, 'Bearer k');
});

test('openai-compatible adapter surfaces HTTP errors', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 500 }));
  const a = new OpenAICompatibleAdapter({ endpoint: 'http://x/v1/chat/completions', model: 'm' });
  await assert.rejects(collect(a.generate({ messages: [] }, new AbortController().signal)), /answered 500/);
});
