// Builds the widget (IIFE + ESM), its lazily loaded runtime, and the CLI.
import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

const browser = {
  bundle: true,
  target: 'es2022',
  platform: 'browser',
  loader: { '.svg': 'dataurl' },
  legalComments: 'none',
  minify: true,
  sourcemap: true,
};

await Promise.all([
  build({ ...browser, entryPoints: ['src/iife.ts'], format: 'iife', globalName: 'deskpal', outfile: 'dist/deskpal.js' }),
  build({ ...browser, entryPoints: ['src/esm.ts'], format: 'esm', outfile: 'dist/deskpal.mjs' }),
  // transformers.js + ONNX Runtime: only fetched on the first question, after consent.
  build({ ...browser, entryPoints: ['src/runtime/index.ts'], format: 'esm', outfile: 'dist/deskpal-runtime.js' }),
  // The same runtime in a module Worker, used when it can start (same origin).
  build({ ...browser, entryPoints: ['src/runtime/worker.ts'], format: 'esm', outfile: 'dist/deskpal-worker.js' }),
  build({
    entryPoints: ['src/cli/main.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    outfile: 'dist/cli.mjs',
    // Native ONNX Runtime for Node; loaded only when embedding.
    external: ['@huggingface/transformers'],
    banner: { js: '#!/usr/bin/env node' },
  }),
]);

await mkdir('dist/ort', { recursive: true });
for (const f of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  await copyFile(`node_modules/onnxruntime-web/dist/${f}`, `dist/ort/${f}`);
}
console.log('built dist/deskpal.js, dist/deskpal.mjs, dist/deskpal-runtime.js, dist/deskpal-worker.js, dist/ort/, dist/cli.mjs');
