# deskpal — spec

A drop-in JavaScript widget that puts an animated, 90s-style desk assistant on
any website. It answers questions from the site's own documentation using
retrieval (RAG) and a small extractive question-answering model that runs **in
the visitor's browser by default**. Generative answers from a larger local or
cloud model are optional (§4).

Decided in the kickoff interview, 2026-10-25. This file is the source of truth;
change it before changing behaviour.

## 1. Principles

- **Self-contained.** The core (character, animation, chat UI, keyword
  retrieval) has zero runtime dependencies. The one sanctioned exception is the
  in-browser inference runtime (§4), which is **lazy-loaded** on the first
  question, after consent, so a page that never asks never downloads it.
- **Original character.** The spirit of the Office assistant, never its
  likeness: no paperclip, no "Clippy" in names, copy or art.
- **Charming, not intrusive.** Mostly passive and a little cheeky (§6).
- **Grounded answers.** Every answer cites the doc sections it came from. The
  default answer is a quote from the docs, never generated text: in testing,
  every generative model small enough for a widget invented things (§10.1).
- **Private by default.** With the default adapter, nothing the user types
  leaves their device.

## 2. Packaging

- Source in **TypeScript**. **esbuild** is a dev dependency only.
- Outputs:
  - `dist/deskpal.js`: one self-contained IIFE file for a plain
    `<script defer src>`. This is what a no-build site (e.g. Praxbook) vendors.
  - `dist/deskpal.mjs`: an ESM build for npm users.
  - `dist/deskpal-runtime.js` and `dist/ort/`: the lazily loaded inference
    runtime (transformers.js and ONNX Runtime's WASM). Sites host these next to
    `deskpal.js`; `runtimeUrl` overrides the location.
- No inline script is required to boot. Configuration is read from `data-*`
  attributes on the script tag, or from a JSON `<script type="application/json"
  id="deskpal-config">` block, so it works under a strict CSP. `deskpal.init({...})`
  is available for sites that want JS config.
- Styles are injected into a **Shadow DOM** so the host page's CSS can't break
  the widget and the widget can't leak into the page.
- License: **MIT**.

## 3. Knowledge: prebuilt index

- CLI: `npx deskpal build-index <docs-dir> -o deskpal-index.json`
  - Reads Markdown and HTML, splits by heading into chunks (with a size cap),
    and keeps `{id, title, heading path, url, text}`.
  - Embeds each chunk with the **same embedding model and code path the browser
    uses** (`src/rag/embedding.ts`), so query and document vectors always
    match. The index records the model id and dimension. The widget refuses an
    index built with a different model rather than returning nonsense.
    `--no-embed` builds a keyword-only index.
  - **Embedding model: `Xenova/bge-small-en-v1.5`** (int8, 34 MB, MIT, CLS
    pooling, BGE query prefix). Chosen 2026-10-25: best retrieval of the three
    candidates, and browser vectors match Node's exactly.
  - Vectors stored quantised (int8, base64) to keep the file small.
- Browser: loads the index as a static file, embeds the query, and ranks by
  0.7 × cosine + 0.3 × keyword (BM25-lite) score, which helps with names and
  exact terms. Without vectors (keyword-only index, or download declined) it
  ranks by keyword score alone.
- **Relevance cutoff:** below `minScore` (default 0.45 with vectors, 0.3
  keyword-only) nothing counts, and the answer is "I don't know that one". In
  testing this alone rejected every off-topic question.
- If no model is available or allowed, the answer is the best-matching
  snippets themselves, with links. That is still useful.

## 4. Model backends (pluggable)

```ts
type ModelAdapter = ExtractiveAdapter | GenerativeAdapter;

interface ExtractiveAdapter {
  kind: 'extract';
  ready(onProgress?: (p: number) => void): Promise<void>;
  /** Best answer span across the passages, or null below the confidence floor. */
  extract(question: string, passages: string[], signal: AbortSignal): Promise<Extract | null>;
}
interface Extract { passage: number; answer: string; score: number }

interface GenerativeAdapter {
  kind: 'generate';
  ready(onProgress?: (p: number) => void): Promise<void>;
  generate(prompt: Prompt, signal: AbortSignal): AsyncIterable<string>;
}

interface Embedder {
  readonly id: string;   // must equal the index's model id (see §3)
  readonly dim: number;
  embedQuery(question: string): Promise<Float32Array>;
}
```

- **`browser` (default): extractive.** transformers.js (ONNX Runtime Web, WASM)
  runs **`Xenova/distilbert-base-cased-distilled-squad`** (int8, 66 MB,
  Apache-2.0). It picks the answer span out of the retrieved sections, and the
  bubble shows that span highlighted inside its section, with the link. Below
  `minAnswerScore` (default 0.1) the answer is "I don't know that one".
  English only for now (§10.4).
- **`browser-generative` (planned, opt-in):** a generative model in the
  browser, offered only on devices that report WebGPU and enough memory. The
  candidate is Qwen3-0.6B (needs ~2 GB RAM); it waits on benchmarks on capable
  hardware (§10.5). Not in v1.
- **`openai-compatible`: external and cloud models.** Any
  `/v1/chat/completions` endpoint, local (Ollama, llama.cpp server, vLLM) or
  hosted. Streams. It sends the question and the retrieved doc excerpts to
  that endpoint, so it is not private by default and the docs say so. API keys
  never go in the page: sites put hosted APIs behind their own proxy.
- **`none`:** retrieval-only answers.
- **Consent and loading.** Whatever needs the runtime (the `browser` adapter,
  or query embeddings for an index with vectors) asks once in the bubble,
  "download ~N MB?", and remembers the answer per site. On yes it shows a
  progress bar and the `download` animation; the browser caches the files. On
  no, it falls back to keyword search and snippet answers.
- **Model URL is configurable** (`modelHost`). It defaults to the public
  Hugging Face CDN, and the docs recommend self-hosting the weights on the
  site's own origin (keeps CSP at `'self'`, no third party sees who uses it).
- Document the CSP needs: WASM requires `'wasm-unsafe-eval'` in `script-src`,
  and a model or endpoint on another origin needs `connect-src`. The runtime
  imports its WASM loader from its own URL (never `blob:`), so `script-src`
  needs no `blob:`. The built-in skin is inlined as a `data:` image, so it needs
  `img-src data:` unless the site self-hosts the skin and sets `skin`.

## 5. Character and animation

- **Sprite engine:** sprite sheets plus a JSON manifest per character:
  `{ frameSize, sheets, animations: { name: { frames, fps, loop, next? } } }`.
  Rendered with a `<canvas>` (or a CSS `background-position` stepper) and driven
  by a small state machine.
- **Required animation set** (every skin provides these):
  `idle`, `idle-fidget` (blink, look around), `bored`, `sleep`, `wake`,
  `greet`, `wave-goodbye`, `listening`, `thinking`, `talking`, `happy`,
  `confused`, `sorry` (no answer found), `pointing` (at a citation),
  `drag` (held), `land` (dropped), `hide`, `appear`, `download` (model loading).
- **Skins:** the default mascot is drawn by us (generated from code into sprite
  sheets). Custom characters drop in with their own manifest. The skin format is
  documented as a public contract.
- **Default mascot:** an office-supply object (concept to be chosen from 2–3
  sketches: e.g. bendy pencil, stapler, sticky note).
- **Reduced motion:** under `prefers-reduced-motion`, animations become
  still key poses. Every expression has a text alternative announced to
  assistive tech when it changes meaning (e.g. "thinking…").

## 6. Behaviour

- Idles in a corner with ambient fidgets. It gets bored and falls asleep after
  long inactivity, and wakes on hover or click.
- Click it to open the speech bubble with a text input. Answers appear as a
  highlighted quote (extractive) or stream in (generative).
- **At most one unprompted tip per page view**, and none if the user has
  dismissed it on this site. No "It looks like you're…" tracking of form fields.
- **Draggable** anywhere, **dismissable**. Position and hidden state are
  remembered per site in `localStorage`, wrapped in try/catch, and work without
  storage.
- **Sound effects:** optional retro bleeps, **muted by default**, with a toggle
  in the bubble.
- Keyboard: a focusable launcher button, Esc closes, and the bubble is an ARIA
  dialog with a live region for streamed answers.

## 7. Answers

- **Extractive (default):** the answer span, highlighted in context within its
  section, with that section's link, then the other matching sections.
- **Generative:** the prompt contains the top-k chunks and a strict
  instruction to answer only from them, in one or two sentences, and to say so
  when they don't cover the question. Output is capped at 80 tokens.
- Each answer ends with source links (title + heading path → url). The
  character plays `pointing` toward them.
- When retrieval finds nothing above the cutoff, or the extractive score is
  below `minAnswerScore`, it plays `sorry` and answers "I don't know that one",
  plus the closest links if any.

## 8. Repo layout (planned)

```
src/core/        state machine, config, storage
src/sprite/      sprite engine, manifest loader
src/ui/          shadow-DOM bubble, launcher, drag
src/rag/         index loader, search, embedding spec, prompt builder
src/adapters/    openai-compatible, runtime loader
src/runtime/     lazily loaded: transformers.js embedder + extractive QA
src/cli/         build-index
skins/default/   sprite sheets + manifest (+ generator script)
demo/            static demo site with its own docs and index
```

## 9. Out of scope for v1

Voice input/output, multi-turn memory beyond the open bubble, crawling the site
at runtime, analytics of any kind, and a hand-written inference runtime.

## 10. Open questions

1. ~~WebLLM vs transformers.js~~ **Decided 2026-10-25: transformers.js.** It
   has a WASM fallback (WebLLM is WebGPU-only), and it runs the same embedding
   code in Node and the browser (§3). **Default answer model decided the same
   day: extractive (§4).** 13 models were compared on the demo docs
   (`scripts/spike-quality.ts`). Every generative model of 0.5B parameters or
   fewer invented facts, including the RAG-specialised Pleias-RAG-350M, which
   invented its citation quotes. Qwen3-0.6B was best (2 of 5 good, failed
   safely) but needs ~2 GB of RAM. DistilBERT-SQuAD answered 4 of 5 from the
   docs at 66 MB.
2. ~~Embedding model~~ **Decided 2026-10-25: bge-small-en-v1.5** (§3).
3. Default mascot concept, chosen from sketches.
4. A multilingual extractive model; DistilBERT-SQuAD is English only.
5. The `browser-generative` model: benchmark Qwen3-0.6B and larger models with
   the spike page (`npm run spike`) on WebGPU hardware, for quality and
   first-answer latency.
6. Run inference in a Web Worker so WASM inference never blocks the page.
