# Configuration

Options can come from three places. Later ones win:

1. `data-*` attributes on the script tag, such as `data-index` or `data-top-k`.
2. A JSON block: `<script type="application/json" id="deskpal-config">`.
3. Options passed to `deskpal.init({...})`.

Add `data-auto="false"` to the script tag to stop it booting on its own.

## Options

- `index`: URL of the search index built by `deskpal build-index`.
- `adapter`: how answers are made: `browser` (default, quoted from your docs on
  the visitor's device), `browser-generative` (experimental: written by a
  ~800 MB model on the visitor's device, best with a GPU), `openai-compatible`,
  `anthropic`, `custom` or `none`. See Models.
- `endpoint`, `model`: where the `openai-compatible` or `anthropic` adapter
  sends questions, and which model it asks for. For `browser-generative`,
  `model` is an ONNX model id on Hugging Face (default Gemma 3 1B).
- `apiKey`: a bearer token for `openai-compatible`. Visitors can read it, so
  use it only with a local server or your own proxy.
- `generate`: the function the `custom` adapter calls (`init()` only).
- `modelHost`: base URL for self-hosted model files, laid out as
  `{modelHost}/{model id}/...`. Hugging Face when unset.
- `runtimeUrl`: URL of `deskpal-runtime.js`. By default it is found next to the
  widget script.
- `skin`: URL of a custom character's skin manifest.
- `name`: the name shown in the speech bubble, and what `{name}` becomes in its lines.
- `greeting`: the first thing it says when opened. A random greeting from its
  voice when unset.
- `voice`: its lines, set by set (JSON block or `init()` only). See
  [Personality](#personality).
- `smallTalk`: reply to greetings, thanks, jokes and the like without
  searching the docs (default `true`).
- `tip`: one unprompted tip shown per page view. Leave it out for no tip.
- `tipDelay`: milliseconds before the tip appears (default 20000).
- `position`: starting corner: `bottom-right`, `bottom-left`, `top-right` or `top-left`.
- `theme`: the speech bubble's look: `modern` (default: clean and rounded) or
  `retro` (ink outlines and hard drop shadows, to match the 90s character).
- `fontSize`: text size in the bubble, in CSS pixels. Defaults to 15 for
  `modern` and 13 for `retro`.
- `accent`: colour of links, buttons and the visitor's questions, such as
  `#0a7d5a` or `rgb(10 125 90)`. With a hex colour, the text on it turns dark
  or light to stay readable. See [Look](#look) for more control.
- `scale`: pixel scale of the character (default 3).
- `topK`: how many doc sections to use per answer (default 4).
- `minScore`: relevance needed for a section to count, from 0 to 1. The default
  is 0.45 when the index has embeddings and 0.3 when it is keyword-only.
- `minAnswerScore`: how confident the answer model must be to pick out an
  answer (default 0.1). Below that it shows the matching sections instead.
- `sureAnswerScore`: how confident it must be to present the answer as sure,
  rather than "I think this is it, but double-check" (default 0.5).
- `worker`: run the answer models in a Web Worker so the page and the character
  stay smooth (default `true`). It needs `deskpal-worker.js` on your own origin;
  otherwise, or with `data-worker="false"`, they run on the page's main thread.

## Look

Beyond `theme`, `fontSize` and `accent`, your own stylesheet can set these
CSS variables on `[data-deskpal]`. They reach inside the widget's shadow root,
and nothing else from your page does.

```css
[data-deskpal] {
  --dp-font: "Inter", system-ui, sans-serif;  /* a font your page already loads */
  --dp-radius: 12px;                         /* corners of the bubble */
  --dp-accent: #0a7d5a;
  --dp-on-accent: #ffffff;                   /* text on the accent colour */
  --dp-ink: #1d2030;                         /* text */
  --dp-muted: #6a6f82;                       /* secondary text */
  --dp-bg: #ffffff;                          /* the bubble */
  --dp-surface: #f1f2f6;                     /* answers and the input box */
  --dp-line: #e3e5ec;                        /* dividers */
}
```

The widget switches to its own dark colours when the visitor's system is in
dark mode. If you set colours, set dark ones too, inside
`@media (prefers-color-scheme: dark)`.

## Personality

Every line it says comes from a voice: `greeting`, `thinking`, `found`,
`unsure`, `snippets`, `dontKnow`, `noDocs`, `error`, `nextBest`,
`outOfIdeas`, and the small-talk replies `hello`, `thanks`, `bye`, `who`,
`help`, `howAreYou`, `praise`, `insult` and `joke`. Each is one line or a list
to pick from at random. Replace any of them, for example to translate them:

```json
{
  "name": "Penny",
  "voice": {
    "found": ["Voilà !", "Trouvé !"],
    "who": "Je suis {name}, et je connais cette documentation par cœur."
  }
}
```

A skin can bring its own voice too; your config wins over the skin's.

## Remembered settings

Where you drag the character, whether you hid it, whether you dismissed the
tip, whether sound is on and your answer to the download question are
remembered per site in `localStorage`. If
storage is blocked, they last for the page view only.
