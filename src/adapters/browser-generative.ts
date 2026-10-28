import type { Message } from '../rag/prompt.ts';
import type { GenerativeAdapter } from './types.ts';

/**
 * A writer that runs on the visitor's device (SPEC §4, `browser-generative`).
 * Experimental: only ~1B-parameter models write grounded answers, and they
 * need a capable GPU and a download of most of a gigabyte.
 */
export interface GenModel {
  id: string;
  /** Quantisation per device: WebGPU with and without shader-f16, and WASM. */
  dtype: { webgpu: string; webgpuNoF16: string; wasm: string };
  sizeMB: number;
  maxNewTokens: number;
}

/** The only model under 2B that answered 5/5 with citations on a phone (SPEC §11.5). */
export const DEFAULT_GENERATOR: GenModel = {
  id: 'onnx-community/gemma-3-1b-it-ONNX',
  dtype: { webgpu: 'q4f16', webgpuNoF16: 'q4', wasm: 'q4' },
  sizeMB: 764,
  maxNewTokens: 200,
};

/** The loaded model, wherever it runs. One generation at a time. */
export interface LocalGenerator {
  readonly device: 'webgpu' | 'wasm';
  readonly dtype: string;
  /** Resolves when the answer is complete or stopped. */
  run(messages: Message[], onPiece: (text: string) => void): Promise<void>;
  /** Ends the current generation early. */
  stop(): void;
}

/** Turns the callback-style generator into a writer: pieces as they come, stopped on abort. */
export function generatorAdapter(gen: LocalGenerator): GenerativeAdapter {
  return {
    kind: 'generate',
    ready: async () => {},
    async *generate(prompt, signal) {
      const queue: string[] = [];
      let wake: (() => void) | null = null;
      let done = false;
      let error: unknown = null;
      const onAbort = () => gen.stop();
      signal.addEventListener('abort', onAbort);
      gen
        .run(prompt.messages, (piece) => {
          queue.push(piece);
          wake?.();
        })
        .then(
          () => void (done = true),
          (err: unknown) => void ((error = err), (done = true)),
        )
        .finally(() => wake?.());
      try {
        while (true) {
          if (queue.length) {
            const piece = queue.shift()!;
            if (piece) yield piece;
          } else if (done) break;
          else await new Promise<void>((resolve) => (wake = resolve));
          wake = null;
        }
        if (error) throw error;
      } finally {
        signal.removeEventListener('abort', onAbort);
        if (!done) gen.stop();
      }
    },
  };
}
