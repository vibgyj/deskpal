export type Runtime = typeof import('../runtime/index.ts');

/** Rough one-time cost of the runtime itself: transformers.js plus ONNX Runtime's WASM, compressed. */
export const RUNTIME_DOWNLOAD_MB = 7;

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
