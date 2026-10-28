// Builds the runtime spike into demo/spike/: the page script, the lazily
// loaded transformers.js runtime, and a self-hosted copy of ONNX Runtime's WASM.
import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

const out = 'demo/spike';
const common = { bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, sourcemap: true, legalComments: 'none' };

await Promise.all([
  build({ ...common, entryPoints: ['src/spike/spike.ts'], outfile: `${out}/spike.js` }),
  build({ ...common, entryPoints: ['src/spike/runtime.ts'], outfile: `${out}/runtime.js` }),
]);

await mkdir(`${out}/ort`, { recursive: true });
for (const f of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  await copyFile(`node_modules/onnxruntime-web/dist/${f}`, `${out}/ort/${f}`);
}
console.log(`built ${out}/spike.js, ${out}/runtime.js, ${out}/ort/`);
