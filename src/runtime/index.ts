// The lazily loaded inference runtime (dist/deskpal-runtime.js). The widget
// imports it by URL on the first question, after the visitor agrees to the
// download, so pages that never ask never load transformers.js (SPEC §1, §4).
import { env, pipeline } from '@huggingface/transformers';
import type { ExtractiveAdapter } from '../adapters/types.ts';
import { embedAll, queryText, type EmbedModel, type Extractor } from '../rag/embedding.ts';
import { joinPassages, toExtract, type ExtractModel } from '../rag/extract.ts';
import type { Embedder } from '../rag/types.ts';

export interface RuntimeOptions {
  /** Base URL for self-hosted model files, laid out as `{modelHost}/{model id}/...`. */
  modelHost?: string;
}

/** Called with (key, loaded, total) per file as model files download. */
export type FileProgress = (key: string, loaded: number, total: number) => void;

let configured = false;

export function configure(options: RuntimeOptions = {}): void {
  if (configured) return;
  configured = true;
  // ONNX Runtime's WASM ships next to this file (dist/ort/) instead of jsdelivr.
  const ort = new URL('./ort/', import.meta.url).href;
  env.backends.onnx.wasm!.wasmPaths = { mjs: `${ort}ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${ort}ort-wasm-simd-threaded.asyncify.wasm` };
  // Otherwise the loader is re-imported from a blob: URL, which strict CSPs block.
  env.useWasmCache = false;
  env.allowLocalModels = false;
  if (options.modelHost) {
    env.remoteHost = options.modelHost.endsWith('/') ? options.modelHost : `${options.modelHost}/`;
    env.remotePathTemplate = '{model}/';
  }
}

function progressCallback(model: string, onProgress?: FileProgress) {
  return (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status === 'progress' && p.file) onProgress?.(`${model}/${p.file}`, p.loaded ?? 0, p.total ?? 0);
  };
}

export async function loadEmbedder(model: EmbedModel, onProgress?: FileProgress): Promise<Embedder> {
  configure();
  const extractor = (await pipeline('feature-extraction', model.id, {
    dtype: model.dtype as never,
    progress_callback: progressCallback(model.id, onProgress) as never,
  })) as unknown as Extractor;
  return {
    id: model.id,
    dim: model.dim,
    embedQuery: async (question) => (await embedAll(extractor, model, [queryText(model, question)]))[0]!,
  };
}

export async function loadExtractive(model: ExtractModel, minScore: number, onProgress?: FileProgress): Promise<ExtractiveAdapter> {
  configure();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qa: any = await pipeline('question-answering', model.id, {
    dtype: model.dtype as never,
    progress_callback: progressCallback(model.id, onProgress) as never,
  });
  return {
    kind: 'extract',
    ready: async () => {},
    async extract(question, passages, signal) {
      const joined = joinPassages(passages);
      if (!joined.context) return null;
      const out = (await qa(question, joined.context)) as { answer: string; score: number };
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const found = toExtract(passages.slice(0, joined.offsets.length), joined, out.answer, out.score);
      return found && found.score >= minScore ? found : null;
    },
  };
}
