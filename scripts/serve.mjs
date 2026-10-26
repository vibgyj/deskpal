// Serves demo/ with the built widget (dist/) at the site root. No dependencies.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT) || 5173;
const ROOT = new URL('../', import.meta.url).pathname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.css': 'text/css',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm',
};
// The demo runs under the strict CSP the widget documents (SPEC §4): WASM
// compilation for the runtime, and the Hugging Face CDN for model files.
const HF = 'https://huggingface.co https://*.huggingface.co https://*.hf.co';
const CSP = `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' ${HF} http://localhost:11434`;
// The spike adds what in-browser inference needs: WASM compilation and the
// Hugging Face model CDN. Violations are reported on the spike page.
const SPIKE_CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self' 'wasm-unsafe-eval'; " +
  "worker-src 'self' blob:; connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co";
// COI=1 serves cross-origin isolated pages, which lets ONNX Runtime use WASM threads.
const ISOLATION = process.env.COI === '1' ? { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' } : {};

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (/^\/(deskpal(-runtime|-worker)?\.js(\.map)?|ort\/[\w.-]+)$/.test(path)) path = `/dist${path}`;
  else path = `/demo${path.endsWith('/') ? `${path}index.html` : path}`;
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'content-security-policy': path.startsWith('/demo/spike/') ? SPIKE_CSP : CSP,
      ...ISOLATION,
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}).listen(PORT, () => {
  console.log(`deskpal demo: http://localhost:${PORT}/  (spike: /spike/)`);
  // Other devices on the network, e.g. a phone on the same Wi-Fi.
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal && /^(192\.168|10)\./.test(a.address)) console.log(`  on your network: http://${a.address}:${PORT}/`);
  }
});
