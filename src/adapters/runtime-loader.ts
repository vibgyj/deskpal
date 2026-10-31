import type { EmbedModel } from '../rag/embedding.ts';
import type { ExtractModel } from '../rag/extract.ts';
import type { Embedder } from '../rag/types.ts';
import type { FileProgress } from '../runtime/index.ts';
import type { GenModel, LocalGenerator } from './browser-generative.ts';
import type { ExtractiveAdapter } from './types.ts';
import { startWorker } from './worker-client.ts';

export type Runtime = typeof import('../runtime/index.ts');

/** Rough one-time cost of the runtime itself: transformers.js plus ONNX Runtime's WASM, compressed. */
export const RUNTIME_DOWNLOAD_MB = 7;

/** The models, wherever they run. */
export interface ModelRuntime {
  readonly where: 'worker' | 'main';
  loadEmbedder(model: EmbedModel, onProgress?: FileProgress): Promise<Embedder>;
  loadExtractive(model: ExtractModel, minScore: number, onProgress?: FileProgress): Promise<ExtractiveAdapter>;
  loadGenerator(model: GenModel, onProgress?: FileProgress): Promise<LocalGenerator>;
}

let loading: Promise<Runtime> | null = null;

/**
 * Imports dist/deskpal-runtime.js by URL, once. Kept out of the bundle so
 * pages that never ask a question never download it (SPEC §1).
 */
export function loadRuntime(url: string): Promise<Runtime> {
  loading ??= (import(/* webpackIgnore: true */ /* @vite-ignore */ url) as Promise<Runtime>).catch((err: unknown) => {
    loading = null;
    throw err;
  });
  return loading;
}

/**
 * The runtime in a Web Worker (deskpal-worker.js, next to deskpal-runtime.js)
 * when it can start, otherwise on the main thread (SPEC §4).
 */
export async function startRuntime(runtimeUrl: string, options: { modelHost?: string; worker: boolean }): Promise<ModelRuntime> {
  const { modelHost } = options;
  if (options.worker && typeof Worker !== 'undefined') {
    try {
      return await startWorker(new URL('deskpal-worker.js', runtimeUrl).href, { modelHost });
    } catch (err) {
      console.warn('deskpal: could not start the model worker; running models on the main thread instead.', err);
    }
  }
  const rt = await loadRuntime(runtimeUrl);
  rt.configure({ modelHost });
  return { where: 'main', loadEmbedder: rt.loadEmbedder, loadExtractive: rt.loadExtractive, loadGenerator: rt.loadGenerator };
}
