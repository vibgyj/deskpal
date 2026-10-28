import type { Message } from '../rag/prompt.ts';
import type { GenModel, LocalGenerator } from './browser-generative.ts';
import type { EmbedModel } from '../rag/embedding.ts';
import type { Extract, ExtractModel } from '../rag/extract.ts';
import type { Embedder } from '../rag/types.ts';
import type { FileProgress, RuntimeOptions } from '../runtime/index.ts';
import type { WorkerRequest, WorkerResponse } from '../runtime/protocol.ts';
import type { ModelRuntime } from './runtime-loader.ts';
import type { ExtractiveAdapter } from './types.ts';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: FileProgress; onPiece?: (text: string) => void };
type Request = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

/**
 * Starts deskpal-worker.js and configures it. Rejects when the Worker can't
 * start: a runtime on another origin (browsers refuse cross-origin Workers),
 * a missing file, or a CSP without worker-src for it.
 */
export async function startWorker(url: string, options: RuntimeOptions): Promise<ModelRuntime> {
  const worker = new Worker(url, { type: 'module', name: 'deskpal' });
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let dead: Error | null = null;

  const fail = (err: Error) => {
    dead = err;
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker.terminate();
  };
  worker.addEventListener('error', (e) => {
    e.preventDefault();
    fail(new Error(`deskpal: the model worker failed${e.message ? `: ${e.message}` : ''}`));
  });
  worker.addEventListener('messageerror', () => fail(new Error('deskpal: unreadable message from the model worker')));
  worker.addEventListener('message', (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    const p = pending.get(msg.id);
    if (!p) return;
    if ('progress' in msg) return p.onProgress?.(...msg.progress);
    if ('piece' in msg) return p.onPiece?.(msg.piece);
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error));
  });

  const call = <T>(req: Request, onProgress?: FileProgress, onPiece?: (text: string) => void): Promise<T> => {
    if (dead) return Promise.reject(dead);
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress, onPiece });
      worker.postMessage({ ...req, id });
    });
  };

  await call({ op: 'configure', options });

  return {
    where: 'worker',
    async loadEmbedder(model: EmbedModel, onProgress?: FileProgress): Promise<Embedder> {
      await call({ op: 'loadEmbedder', model }, onProgress);
      return { id: model.id, dim: model.dim, embedQuery: (text) => call<Float32Array>({ op: 'embed', text }) };
    },
    async loadExtractive(model: ExtractModel, minScore: number, onProgress?: FileProgress): Promise<ExtractiveAdapter> {
      await call({ op: 'loadExtractive', model, minScore }, onProgress);
      return {
        kind: 'extract',
        ready: async () => {},
        async extract(question, passages, signal) {
          const found = await call<Extract | null>({ op: 'extract', question, passages });
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          return found;
        },
      };
    },
    async loadGenerator(model: GenModel, onProgress?: FileProgress): Promise<LocalGenerator> {
      const { device, dtype } = await call<Pick<LocalGenerator, 'device' | 'dtype'>>({ op: 'loadGenerator', model }, onProgress);
      return {
        device,
        dtype,
        run: (messages: Message[], onPiece) => call<void>({ op: 'generate', messages }, undefined, onPiece),
        stop: () => void call({ op: 'stop' }).catch(() => {}),
      };
    },
  };
}
