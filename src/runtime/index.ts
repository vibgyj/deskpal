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
    // The next device fetches a different file; take this one's bytes off the bar.
    const seen = new Map<string, number>();
    const track: FileProgress = (key, loaded, total) => {
      seen.set(key, total);
      onProgress?.(key, loaded, total);
    };
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const generator: any = await pipeline('text-generation', model.id, {
        device,
        dtype: dtype as never,
        progress_callback: progressCallback(model.id, track) as never,
      });
      // On WASM a token's inference never yields to the event loop, so a `stop`
      // or another question would wait for the whole answer. One hop per token
      // lets them in.
      const forward = generator.model.forward.bind(generator.model);
      generator.model.forward = async (inputs: unknown) => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return forward(inputs);
      };
      const stopper = new InterruptableStoppingCriteria();
      // Each run waits for the one before: two at once on one session hang.
      let last: Promise<void> = Promise.resolve();
      let active: AbortSignal | null = null;
      return {
        device,
        dtype,
        run(messages, onPiece, signal) {
          const previous = last;
          // The newest question wins: end the answer in progress.
          stopper.interrupt();
          const run = (async () => {
            await previous.catch(() => {});
            if (signal.aborted) return;
            stopper.reset();
            active = signal;
            const onAbort = () => active === signal && stopper.interrupt();
            signal.addEventListener('abort', onAbort);
            try {
              const streamer = new TextStreamer(generator.tokenizer, { skip_prompt: true, skip_special_tokens: true, callback_function: onPiece });
              await generator(messages, { max_new_tokens: model.maxNewTokens, do_sample: false, repetition_penalty: 1.05, streamer, stopping_criteria: stopper });
            } finally {
              signal.removeEventListener('abort', onAbort);
              active = null;
            }
          })();
          last = run;
          return run;
        },
      };
    } catch (err) {
      console.warn(`deskpal: could not load ${model.id} on ${device}`, err);
      for (const [key, total] of seen) onProgress?.(key, 0, total);
      lastError = err;
    }
  }
  throw lastError;
}
