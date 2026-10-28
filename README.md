# deskpal

A drop-in, 90s-style animated desk assistant that answers questions from your
site's own docs. By default it runs entirely in the visitor's browser and
answers by quoting your docs, so it never makes things up. See
[SPEC.md](SPEC.md) for the design.

```sh
npx deskpal build-index ./docs -o deskpal-index.json --base-url /docs/
```

Copy everything in `dist/` (`deskpal.js`, `deskpal-runtime.js`,
`deskpal-worker.js` and `ort/`) and
`deskpal-index.json` to your site, then:

```html
<script defer src="/deskpal.js" data-index="/deskpal-index.json"></script>
```

It has a personality that needs no model: lines for every situation, small
talk, and expressions that follow how sure it is (SPEC §7). On the first real
question it asks the visitor to download about 110 MB of model files, once,
which then run in a Web Worker. Say no and it shows the matching doc sections
instead.
To have a model write answers instead, use `adapter: "openai-compatible"` (Ollama,
llama.cpp, most clouds), `"anthropic"` (Claude, through your proxy) or
`"custom"` (your own function); see `demo/docs/models.md`.

## Development

```sh
npm install
npm test          # unit tests (node --test, no build needed)
npm run typecheck
npm run build     # dist/: deskpal.js (IIFE), deskpal.mjs (ESM), deskpal-runtime.js, deskpal-worker.js + ort/, cli.mjs
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

The 2026-10-25 comparisons are summarised in SPEC §11: 13 models for answer
quality, phone results for 1B+ models, and smaller extractive models.

## Status

Working: the sprite engine and skin format (with optional animations), the
shadow-DOM bubble, the behaviour state machine, drag/hide/remember, the tip,
sounds and reduced motion. The persona: voice lines, small talk, confidence and
follow-ups. Answers: hybrid retrieval (bge-small plus keywords) with a
relevance cutoff, extractive answers in a Web Worker, plus the
`openai-compatible`, `anthropic`, `custom` and `none` adapters. `build-index` for Markdown and HTML,
with embeddings.

Open (SPEC §4, §11):

1. **Mascot**: `skins/default` is a placeholder blob.
2. **Multilingual answers**: the extractive model is English only.
3. **More writers**: `gemini` and an experimental `browser-generative`, and
   falling back to extractive answers when a writer fails.
4. **Built-in browser models**: whether Chrome's Prompt API can be a writer.

## License

MIT
