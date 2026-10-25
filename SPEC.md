# deskpal — spec

A drop-in JavaScript widget that puts an animated, 90s-style desk assistant on
any website. It answers questions from the site's own documentation using
retrieval (RAG) and a small language model that runs **in the visitor's browser
by default**.

Decided in the kickoff interview, 2026-10-25. This file is the source of truth;
change it before changing behaviour.

## 1. Principles

- **Self-contained.** The core (character, animation, chat UI, retrieval) has
  zero runtime dependencies. The one sanctioned exception is the in-browser
  inference runtime (§4), which is **lazy-loaded** on the first question, so a
  page that never asks never downloads it.
- **Original character.** The spirit of the Office assistant, never its
  likeness: no paperclip, no "Clippy" in names, copy or art.
- **Charming, not intrusive.** Mostly passive and a little cheeky (§6).
- **Grounded answers.** Every answer cites the doc sections it came from. A
  small model left to talk on its own invents things; citations are the guard.
- **Private by default.** With the default adapter, nothing the user types
  leaves their device.

## 2. Packaging

- Source in **TypeScript**. **esbuild** is a dev dependency only.
- Outputs:
  - `dist/deskpal.js`: one self-contained IIFE file for a plain
    `<script defer src>`. This is what a no-build site (e.g. Praxbook) vendors.
  - `dist/deskpal.mjs`: an ESM build for npm users.
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
    uses**, so query and document vectors always match. The index records
    the model id and dimension. The widget refuses an index built with a
    different model rather than returning nonsense.
  - Vectors stored quantised (int8, or float16 base64) to keep the file small.
- Browser: loads the index as a static file, embeds the query, takes the cosine
  top-k, and optionally adds a keyword (BM25-lite) score for names and exact
  terms that embeddings handle badly.
- If no LLM is available or configured, the answer is the best-matching
  snippets themselves, with links. That is still useful.

## 4. Model backends (pluggable)

```ts
interface ModelAdapter {
  ready(onProgress?: (p: number) => void): Promise<void>;
  generate(prompt: Prompt, signal: AbortSignal): AsyncIterable<string>;
}
interface Embedder { embed(texts: string[]): Promise<Float32Array[]>; }
```

- **`browser` (default):** an existing runtime (WebLLM or transformers.js;
  choose in a spike) running a ~0.5B instruct model on WebGPU, with WASM as the
  fallback. Loaded only when the user first asks. It shows a one-time
  "download ~N MB?" consent in the bubble, a progress bar, and caches the model.
- **`openai-compatible`:** any `/v1/chat/completions` endpoint (Ollama,
  llama.cpp server, vLLM, or a hosted API). Streams.
- **`none`:** retrieval-only answers.
- **Model URL is configurable.** It defaults to the public Hugging Face CDN for
  the demo, and docs recommend self-hosting the weights on the site's own
  origin (keeps CSP at `'self'`, no third party sees who uses it).
- Document the CSP needs: WASM requires `'wasm-unsafe-eval'` in `script-src`,
  and a model on another origin needs `connect-src`.

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
- Click it to open the speech bubble with a text input. Answers stream in.
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

- The prompt contains the top-k chunks and a strict instruction to answer only
  from them and say so when they don't cover the question.
- Each answer ends with source links (title + heading path → url). The
  character plays `pointing` toward them.
- When nothing scores above a threshold, it plays `sorry` and answers "I don't
  know that one", plus the closest links if any.

## 8. Repo layout (planned)

```
src/core/        state machine, config, storage
src/sprite/      sprite engine, manifest loader
src/ui/          shadow-DOM bubble, launcher, drag
src/rag/         index loader, search, prompt builder
src/adapters/    browser, openai-compatible, none
src/cli/         build-index
skins/default/   sprite sheets + manifest (+ generator script)
demo/            static demo site with its own docs and index
```

## 9. Out of scope for v1

Voice input/output, multi-turn memory beyond the open bubble, crawling the site
at runtime, analytics of any kind, and a hand-written inference runtime.

## 10. Open questions

1. WebLLM vs transformers.js for generation (size, WebGPU fallback, licence).
   Decide by a spike that measures first-answer latency on a mid-range laptop.
2. Which embedding model (small enough to run in the browser for queries and
   identical in the Node CLI).
3. Default mascot concept, chosen from sketches.
