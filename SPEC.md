# deskpal — spec

A drop-in JavaScript widget that puts an animated, 90s-style desk assistant on
any website. It answers questions from the site's own documentation using
retrieval (RAG) and a small extractive question-answering model that runs **in
the visitor's browser by default**. Its personality does not depend on any
model, so it is just as friendly on a browser that can't run one. Generated
answers from a larger model are an option the site owner turns on (§4).

Decided in the kickoff interview, 2026-10-25. This file is the source of truth;
change it before changing behaviour.

## 1. Principles

- **Self-contained.** The core (character, animation, chat UI, persona, keyword
  retrieval) has zero runtime dependencies. The one sanctioned exception is the
  in-browser inference runtime (§4), which is **lazy-loaded** on the first
  question, after consent, so a page that never asks never downloads it.
- **Works on most browsers.** Every feature a visitor sees by default must
  work without WebGPU, on a mid-range phone. Anything heavier is opt-in and
  falls back gracefully (§4, tiers).
- **Original character.** The spirit of the Office assistant, never its
  likeness: no paperclip, no "Clippy" in names, copy or art.
- **Charming, not intrusive.** Mostly passive and a little cheeky (§6). The
  charm comes from the persona (§7): lines, small talk and animations, not
  from generated text.
- **Grounded answers.** Every answer cites the doc sections it came from. The
  default answer is a quote from the docs, never generated text: in testing,
  every generative model small enough for most browsers invented things
  (§11.1).
- **Private by default.** With the default adapter, nothing the user types
  leaves their device.

## 2. Packaging

- Source in **TypeScript**. **esbuild** is a dev dependency only.
- Outputs:
  - `dist/deskpal.js`: one self-contained IIFE file for a plain
    `<script defer src>`. This is what a no-build site (e.g. Praxbook) vendors.
  - `dist/deskpal.mjs`: an ESM build for npm users.
  - `dist/deskpal-runtime.js`, `dist/deskpal-worker.js` and `dist/ort/`: the
    lazily loaded inference runtime (transformers.js and ONNX Runtime's WASM),
    and the Web Worker that runs it (§4). Sites host these next to
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
  - `--model bge-base-en-v1.5` (768 dims, 110 MB) ranks better: a right
    section in the top 4 for 97% and 100% of the eval's questions, against
    89% for bge-small. Three times the download and the time per question, so
    it is opt-in, and best with `embedEndpoint` (below).
  - Vectors stored quantised (int8, base64) to keep the file small.
- Browser: loads the index as a static file, embeds the query, and ranks by
  cosine and keyword (BM25-lite) score combined: 0.8/0.2 for bge-small,
  0.9/0.1 for bge-base. The keyword share helps with names and exact terms.
  With `embedEndpoint` the site's server embeds the query instead (same code
  path, `src/rag/embedding.ts`), so visitors download no model; if it fails or
  rate-limits, that question falls back to keyword search. Without vectors (keyword-only index, or download declined) it
  ranks by keyword score alone.
- **Relevance cutoff:** below `minScore` (default per model: 0.5 for
  bge-small, 0.475 for bge-base; 0.3 keyword-only) nothing counts, and the answer is "I don't know that one". In
  a labelled eval on two sites (54 real and 33 off-topic questions) it
  rejected every off-topic question but one borderline case the docs do
  touch on, so **every answer path, including generated ones, sits behind
  it.** The weights and cutoff came from that eval (2026-10-31).
- If no model is available or allowed, the answer is the best-matching
  snippets themselves, with links. That is still useful.

## 4. Answer tiers and model backends

| Tier | Runs on | Answer |
|---|---|---|
| 0. No download | every browser | the matching doc sections (keyword search) |
| 1. **Default** | most browsers (WASM, ~110 MB once) | a quote from the docs, picked by an extractive model |
| 2. Writer (opt-in by the site owner) | wherever it is configured | a written answer with citations |

A higher tier always falls back to the one below: a writer that errors,
declines or can't run on the device gives way to tier 0 (falling back to tier
1 instead, when its models are already loaded, is planned). The persona (§7)
is the same in every tier.

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

### Tier 1: `browser` (default, extractive)

transformers.js (ONNX Runtime Web, WASM) runs
**`Xenova/distilbert-base-cased-distilled-squad`** (int8, 66 MB, Apache-2.0).
It picks the answer span out of the retrieved sections, and the bubble shows
that span highlighted inside its section, with the link. At or above
`sureAnswerScore` (default 0.5) it is presented as sure; below that as a best
guess (§7). Below `minAnswerScore` (default 0.1) it shows the matching
sections instead: they already passed the relevance cutoff, and in testing
the right span often scored low on paraphrased questions. English only for now
(§11.4); no smaller model did as well (§11.7).

- **Web Worker.** The models run in a module Worker (`deskpal-worker.js`) so
  inference never blocks the page and the character keeps animating. Browsers
  only start a Worker from the page's own origin, so when the runtime is
  hosted elsewhere, the Worker can't start, or `worker: false` is set, the
  runtime runs on the main thread instead.
- **Consent and loading.** Whatever needs the runtime (the `browser` adapter,
  or query embeddings for an index with vectors) asks once in the bubble,
  "download ~N MB?", and remembers the answer per site. On yes it shows a
  progress bar and the `download` animation; the browser caches the files. On
  no, it falls back to tier 0.
- **Model URL is configurable** (`modelHost`). It defaults to the public
  Hugging Face CDN, and the docs recommend self-hosting the weights on the
  site's own origin (keeps CSP at `'self'`, no third party sees who uses it).

### Tier 2: writers

Generated answers need a model bigger than most browsers can run (§11.1,
§11.5), so a writer is treated like an external service, even when it runs on
the visitor's own GPU. Writers get the same prompt: the top-k sections and a
strict instruction to answer only from them (§8). Several API contracts are
supported:

- **`openai-compatible`** (built): any `/v1/chat/completions` endpoint, local
  (Ollama, llama.cpp server, LM Studio, vLLM) or hosted (OpenRouter, Groq, and
  providers' own OpenAI-compatible endpoints). Streams.
- **`anthropic`** (built): the Claude Messages API (`anthropic-version:
  2026-10-21`), streamed, through the site's proxy. Default model
  `claude-opus-5-5` at `effort: low` (answers are short and grounded), with
  server-side refusal fallback (`fallbacks: "default"`) on the models that
  support it. Thinking deltas are skipped; a `refusal` stop reason or stream
  error discards the partial answer. Plain `fetch`, not Anthropic's SDK, to
  keep zero runtime dependencies (§1).
- **`gemini`** (planned): the Gemini API, streaming.
- **`custom`** (built): the site passes `generate(prompt, signal)` to `init()`,
  returning text, a promise of text or an `AsyncIterable<string>`. The prompt
  carries the chat messages plus the raw question and sources. This covers any
  other API and the site's own backend and auth.
- **`browser-generative`** (experimental, built): a generative model on the
  visitor's device, in the model worker. Default Gemma 3 1B
  (`onnx-community/gemma-3-1b-it-ONNX`), the only model of 1B or more that
  loaded on a phone in testing (§11.5); `model` takes another ONNX model id.
  WebGPU (q4f16, or q4 without shader-f16) when the device has a usable GPU,
  otherwise WASM (q4), which is very slow. ~800 MB, behind the same download
  prompt. Opt-in only; checking the device's WebGPU limits before offering it is
  still to do.
- **Built-in browser models** (to investigate, §11.8): where the browser
  provides an on-device model (e.g. Chrome's Prompt API), use it with no
  download from the site.

Writers that send the question and excerpts to a server are not private, and
the docs say so. API keys never go in the page: sites put hosted APIs behind
their own proxy.

### `none`

Tier 0 only: retrieval and snippets, never a download prompt.

### CSP

WASM requires `'wasm-unsafe-eval'` in `script-src`, and a model or endpoint on
another origin needs `connect-src`. The Worker needs `worker-src 'self'` (or a
`script-src` that allows its URL). The runtime imports its WASM loader from its
own URL (never `blob:`), so neither needs `blob:`. The built-in skin is inlined
as a `data:` image, so it needs `img-src data:` unless the site self-hosts the
skin and sets `skin`.

## 5. Character and animation

- **Sprite engine:** sprite sheets plus a JSON manifest per character:
  `{ frameSize, sheets, animations: { name: { frames, fps, loop, next? } }, voice? }`.
  Rendered with a `<canvas>` (or a CSS `background-position` stepper) and driven
  by a small state machine.
- **Required animation set** (every skin provides these):
  `idle`, `idle-fidget` (blink, look around), `bored`, `sleep`, `wake`,
  `greet`, `wave-goodbye`, `listening`, `thinking`, `talking`, `happy`,
  `confused`, `sorry` (no answer found), `pointing` (at a citation),
  `drag` (held), `land` (dropped), `hide`, `appear`, `download` (model loading).
- **Optional animations**, each with a fallback the widget plays when a skin
  lacks it: `wave` (→ `greet`), `unsure` (→ `confused`), `blush` (→ `happy`),
  `laugh` (→ `happy`), `working` (→ `thinking`: a long wait on the model,
  from 1.5 s), `nope` (→ `sorry`: a head shake when the docs have no answer). Optional animations let new expressions arrive without
  breaking existing skins.
- **Skins:** the default mascot is drawn by us (generated from code into sprite
  sheets). Custom characters drop in with their own manifest. The skin format,
  including `voice` (§7), is documented as a public contract.
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

## 7. Persona

The "friendly helper" feel, in every tier, without a generative model.

- **Voice.** Lines for each situation, picked at random from a small set, never
  the same line twice in a row: `greeting`, `thinking`, `found` (confident
  answer), `unsure` (low-confidence answer), `snippets` (tier 0), `dontKnow`,
  `noDocs`, `error`, `nextBest` and `outOfIdeas` (follow-ups), plus small-talk
  replies. `{name}` in a line becomes the assistant's name. The default voice
  is built in; a skin's manifest can carry a `voice` (each mascot its own
  personality), and the site's `voice` config overrides both, line set by line
  set, which also covers translation. `greeting` in config still wins for the
  first line.
- **Thinking line.** If an answer takes more than ~400 ms, a `thinking` line
  ("Let me flip through the docs…") shows in the log until the answer
  replaces it.
- **Small talk.** Greetings, thanks, goodbyes, "who are you", "what can you
  do", "how are you", praise, insults and "tell me a joke" get a reply from the
  voice and an animation (`wave`, `happy`, `blush`, `sorry`, `laugh`), without
  searching the docs. A message counts as small talk only when it has nothing
  else in it: "hi, how do I install it?" is a question. Matching is by phrase
  patterns, which work in every tier. When the query embedder is loaded and a
  short message matched no doc section, it is also compared with example
  phrases for each intent, to catch paraphrases. `smallTalk: false` turns it
  off.
- **Confidence.** An extracted answer scoring at least `sureAnswerScore`
  starts with a `found` line and plays `pointing`; below it, an `unsure` line
  ("I think this is it, but double-check:") and `unsure`.
- **Follow-ups.** Under the latest answer: **Show more** (the whole section)
  and **Not what I meant** (the next best answer from the remaining sections,
  then `outOfIdeas` with the closest links). The source link opens the page.

## 8. Answers

- **Extractive (default):** a persona line, then the answer span highlighted in
  context within its section, with that section's link, then the other
  matching sections and the follow-ups.
- **Generative:** the prompt contains the top-k chunks and a strict
  instruction to answer only from them, in one or two sentences, and to say so
  when they don't cover the question. Output is capped at 80 tokens.
- Each answer ends with source links (title + heading path → url). The
  character plays `pointing` toward them.
- When retrieval finds nothing above the cutoff, it plays `sorry` and answers
  with a `dontKnow` line, plus the closest links if any. When the extractive
  score is below `minAnswerScore`, it shows the matching sections (tier 0).

## 9. Repo layout

```
src/core/        state machine, config, storage
src/persona/     voice, small talk
src/sprite/      sprite engine, manifest loader
src/ui/          shadow-DOM bubble, launcher, drag
src/rag/         index loader, search, embedding spec, prompt builder
src/adapters/    openai-compatible, runtime loader, worker client
src/runtime/     lazily loaded: transformers.js embedder + extractive QA, worker
src/cli/         build-index
skins/default/   sprite sheets + manifest (+ generator script)
demo/            static demo site with its own docs and index
```

## 10. Out of scope for v1

Voice input/output, multi-turn memory beyond the open bubble, crawling the site
at runtime, analytics of any kind, and a hand-written inference runtime.

## 11. Open questions

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
5. ~~Can a browser model write good answers?~~ **Answered 2026-10-25: not on
   most browsers.** On a Pixel phone (WebGPU only after enabling
   `#enable-unsafe-webgpu`), Gemma 3 1B answered 5 of 5 with citations but
   didn't refuse off-topic questions (the relevance cutoff, §3, handles those);
   Llama 3.2 1B and Qwen3 1.7B failed to run. Good answers need ~1B+ models,
   a ~750 MB download and WebGPU, so writers are tier 2 (§4). The persona
   (§7) gives every tier the friendly feel instead.
6. ~~Web Worker~~ **Decided and built 2026-10-25:** the runtime runs in a
   module Worker, with a main-thread fallback (§4). In headless Chromium,
   answering two questions caused no main-thread long tasks with the Worker
   (360 frames in 6 s), against ~1.7 s of long tasks (262 frames) without.
7. ~~A smaller extractive model~~ **Decided 2026-10-25: keep DistilBERT.**
   On 20 questions (18 answerable), MobileBERT-SQuAD2 (27 MB) gave worse spans
   and crashed on contexts over 512 tokens; MiniLM-L12-QA (34 MB) picked wrong
   spans more often, with scores too low to separate right from wrong.
   DistilBERT's right answers scored 0.01–0.77, which is why low scores now
   show the sections rather than "I don't know" (§4).
8. Whether browsers' built-in models (e.g. Chrome's Prompt API) are available
   to ordinary web pages, and good enough to be a writer.
