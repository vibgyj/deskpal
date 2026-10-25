# Configuration

Options can come from three places. Later ones win:

1. `data-*` attributes on the script tag, such as `data-index` or `data-top-k`.
2. A JSON block: `<script type="application/json" id="deskpal-config">`.
3. Options passed to `deskpal.init({...})`.

Add `data-auto="false"` to the script tag to stop it booting on its own.

## Options

- `index`: URL of the search index built by `deskpal build-index`.
- `adapter`: which model writes answers: `browser` (default), `openai-compatible` or `none`.
- `endpoint`, `model`, `apiKey`: settings for the `openai-compatible` adapter.
- `modelHost`: base URL for self-hosted model files, laid out as
  `{modelHost}/{model id}/...`. Hugging Face when unset.
- `runtimeUrl`: URL of `deskpal-runtime.js`. By default it is found next to the
  widget script.
- `skin`: URL of a custom character's skin manifest.
- `name`: the name shown in the speech bubble.
- `greeting`: the first thing it says when opened.
- `tip`: one unprompted tip shown per page view. Leave it out for no tip.
- `tipDelay`: milliseconds before the tip appears (default 20000).
- `position`: starting corner: `bottom-right`, `bottom-left`, `top-right` or `top-left`.
- `scale`: pixel scale of the character (default 3).
- `topK`: how many doc sections to use per answer (default 4).
- `minScore`: relevance needed for a section to count, from 0 to 1. The default
  is 0.45 when the index has embeddings and 0.3 when it is keyword-only.
- `minAnswerScore`: how confident the answer model must be before it answers
  (default 0.1). Below that it says "I don't know that one".

## Remembered settings

Where you drag the character, whether you hid it, whether you dismissed the
tip, whether sound is on and your answer to the download question are
remembered per site in `localStorage`. If
storage is blocked, they last for the page view only.
