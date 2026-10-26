import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startWorker } from '../src/adapters/worker-client.ts';
import type { WorkerRequest, WorkerResponse } from '../src/runtime/protocol.ts';
import { DEFAULT_EMBEDDING } from '../src/rag/embedding.ts';
import { DEFAULT_EXTRACTIVE } from '../src/rag/extract.ts';

/** Stands in for deskpal-worker.js: answers requests the way the real one does. */
class FakeWorker extends EventTarget {
  static last: FakeWorker;
  url: string;
  terminated = false;
  handle: (req: WorkerRequest, reply: (msg: WorkerResponse) => void) => void = (req, reply) => reply({ id: req.id, ok: true });
  constructor(url: string) {
    super();
    this.url = url;
    FakeWorker.last = this;
  }
  postMessage(req: WorkerRequest): void {
    queueMicrotask(() => this.handle(req, (data) => this.dispatchEvent(new MessageEvent('message', { data }))));
  }
  terminate(): void {
    this.terminated = true;
  }
  crash(message: string): void {
    const e = new Event('error', { cancelable: true });
    Object.assign(e, { message });
    this.dispatchEvent(e);
  }
}

function withFakeWorker(t: import('node:test').TestContext): void {
  const original = globalThis.Worker;
  (globalThis as { Worker: unknown }).Worker = FakeWorker;
  t.after(() => void ((globalThis as { Worker: unknown }).Worker = original));
}

test('worker client: loads models with progress, embeds and extracts', async (t) => {
  withFakeWorker(t);
  const rt = await startWorker('https://site.test/deskpal-worker.js', {});
  assert.equal(rt.where, 'worker');
  FakeWorker.last.handle = (req, reply) => {
    if (req.op === 'loadEmbedder') reply({ id: req.id, progress: ['bge/model.onnx', 5, 10] });
    if (req.op === 'embed') return reply({ id: req.id, ok: true, result: new Float32Array([req.text.length]) });
    if (req.op === 'extract') return reply({ id: req.id, ok: true, result: { passage: 1, answer: req.passages[1], score: 0.8 } });
    reply({ id: req.id, ok: true });
  };
  const seen: unknown[] = [];
  const embedder = await rt.loadEmbedder(DEFAULT_EMBEDDING, (...p) => seen.push(p));
  assert.deepEqual(seen, [['bge/model.onnx', 5, 10]]);
  assert.equal(embedder.id, DEFAULT_EMBEDDING.id);
  assert.deepEqual([...(await embedder.embedQuery('abc'))], [3]);
  const qa = await rt.loadExtractive(DEFAULT_EXTRACTIVE, 0.1);
  assert.deepEqual(await qa.extract('q', ['a', 'b'], new AbortController().signal), { passage: 1, answer: 'b', score: 0.8 });
  const aborted = AbortSignal.abort();
  await assert.rejects(qa.extract('q', ['a', 'b'], aborted), { name: 'AbortError' });
});

test('worker client: errors reject the call; a crash rejects everything after', async (t) => {
  withFakeWorker(t);
  const rt = await startWorker('w.js', {});
  const worker = FakeWorker.last;
  worker.handle = (req, reply) => reply({ id: req.id, ok: false, error: 'no such model' });
  await assert.rejects(rt.loadEmbedder(DEFAULT_EMBEDDING), /no such model/);
  worker.handle = () => {};
  const pending = rt.loadExtractive(DEFAULT_EXTRACTIVE, 0.1);
  worker.crash('out of memory');
  await assert.rejects(pending, /model worker failed: out of memory/);
  await assert.rejects(rt.loadEmbedder(DEFAULT_EMBEDDING), /out of memory/);
  assert.ok(worker.terminated);
});

test('worker client: a worker that fails to start rejects, so the widget can fall back', async (t) => {
  withFakeWorker(t);
  FakeWorker.prototype.postMessage = function (this: FakeWorker) {
    queueMicrotask(() => this.crash(''));
  };
  t.after(() => void delete (FakeWorker.prototype as Partial<FakeWorker>).postMessage);
  await assert.rejects(startWorker('missing.js', {}), /model worker failed/);
});
