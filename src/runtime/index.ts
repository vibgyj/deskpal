// The lazily loaded inference runtime (dist/deskpal-runtime.js). The widget
// imports it by URL on the first question, after the visitor agrees to the
// download, so pages that never ask never load transformers.js (SPEC §1, §4).
import { env, InterruptableStoppingCriteria, pipeline, TextStreamer } from '@huggingface/transformers';
import type { GenModel, LocalGenerator } from '../adapters/browser-generative.ts';
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

/** WebGPU first when the device has a usable GPU, then WASM on the CPU. */
async function devices(model: GenModel): Promise<{ device: 'webgpu' | 'wasm'; dtype: string }[]> {
  const out: { device: 'webgpu' | 'wasm'; dtype: string }[] = [];
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  const adapter = await gpu?.requestAdapter().catch(() => null);
  if (adapter) out.push({ device: 'webgpu', dtype: adapter.features.has('shader-f16') ? model.dtype.webgpu : model.dtype.webgpuNoF16 });
  out.push({ device: 'wasm', dtype: model.dtype.wasm });
  return out;
}

export async function loadGenerator(model: GenModel, onProgress?: FileProgress): Promise<LocalGenerator> {
  configure();
  let lastError: unknown;
  for (const { device, dtype } of await devices(model)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const generator: any = await pipeline('text-generation', model.id, {
        device,
        dtype: dtype as never,
        progress_callback: progressCallback(model.id, onProgress) as never,
      });
      const stopper = new InterruptableStoppingCriteria();
      let running: Promise<void> = Promise.resolve();
      return {
        device,
        dtype,
        async run(messages, onPiece) {
          stopper.interrupt();
          await running.catch(() => {});
          stopper.reset();
          const streamer = new TextStreamer(generator.tokenizer, { skip_prompt: true, skip_special_tokens: true, callback_function: onPiece });
          running = generator(messages, { max_new_tokens: model.maxNewTokens, do_sample: false, repetition_penalty: 1.05, streamer, stopping_criteria: stopper });
          await running;
        },
        stop: () => stopper.interrupt(),
      };
    } catch (err) {
      console.warn(`deskpal: could not load ${model.id} on ${device}`, err);
      lastError = err;
    }
  }
  throw lastError;
}
