# deskpal

A drop-in, 90s-style animated desk assistant that answers questions from your
site's own docs. By default it runs entirely in the visitor's browser and
answers by quoting your docs, so it never makes things up. See
[SPEC.md](SPEC.md) for the design.

```sh
npx deskpal build-index ./docs -o deskpal-index.json --base-url /docs/
```

Copy everything in `dist/` (`deskpal.js`, `deskpal-runtime.js` and `ort/`) and
`deskpal-index.json` to your site, then:

```html
<script defer src="/deskpal.js" data-index="/deskpal-index.json"></script>
```

On the first question it asks the visitor to download about 110 MB of model
files, once. Say no and it shows the matching doc sections instead.
`adapter: "openai-compatible"` uses a local or cloud model to write answers
instead (see `demo/docs/models.md`).

## Development

```sh
npm install
npm test          # unit tests (node --test, no build needed)
npm run typecheck
npm run build     # dist/: deskpal.js (IIFE), deskpal.mjs (ESM), deskpal-runtime.js + ort/, cli.mjs
npm run demo      # builds, indexes demo/docs and serves http://localhost:5173
```

The demo server also prints its address on your network, for testing from a
phone. Browsers only enable WebGPU and the model cache over HTTPS or
localhost; on Android Chrome, add the address to
`chrome://flags/#unsafely-treat-insecure-origin-as-secure`.

## Model comparisons

- `npm run spike` serves the runtime spike at `/spike/`. It measures
  first-answer latency and answer quality for in-browser generative models
  (up to 1.7B) on WebGPU and WASM, and retrieval quality for embedding models.
  Use it on the hardware you care about and keep the downloaded JSON.
  `npm run spike:vectors` first lets the page check that browser embeddings
  match the CLI's. `COI=1` serves cross-origin isolated pages, so ONNX
  Runtime can use WASM threads.
- `scripts/spike-quality.ts` compares answer quality in Node, one model per
  process. Run it under a memory cap on small machines.

The 2026-10-25 comparison of 13 models is summarised in SPEC §10.1.

## Status

Working: the sprite engine and skin format, the shadow-DOM bubble, the
behaviour state machine, drag/hide/remember, the tip, sounds and reduced motion.
Answers: hybrid retrieval (bge-small plus keywords) with a relevance cutoff,
extractive answers in the browser, plus the `openai-compatible` and `none`
adapters. `build-index` for Markdown and HTML, with embeddings.

Open (SPEC §10):

1. **Mascot**: `skins/default` is a placeholder blob implementing all 19
   required animations.
2. **Multilingual answers**: the extractive model is English only.
3. **`browser-generative`**: an opt-in generative mode for capable devices,
   waiting on benchmarks.
4. **Web Worker**: run inference off the main thread.

## License

MIT
