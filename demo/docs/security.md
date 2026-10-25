# Security and privacy

## Content Security Policy

deskpal works under a strict CSP. It needs no inline scripts and injects its
styles through constructed stylesheets inside a shadow root.

- The answer model runs WebAssembly: add `'wasm-unsafe-eval'` to `script-src`.
- Model files come from Hugging Face unless you host them yourself, so allow
  `https://huggingface.co https://*.huggingface.co https://*.hf.co` in
  `connect-src`, or set `modelHost` to your own origin.
- An `openai-compatible` endpoint on another origin needs that origin in
  `connect-src`.
- The built-in character is an inline image, so allow `img-src data:`, or host
  the default skin yourself and set `skin`.

## Privacy

With the default adapter, questions never leave the visitor's device: the
model files are downloaded once and everything runs in the browser. deskpal has
no analytics and sends no telemetry. Host the model files on your own origin so
no third party sees who uses it.
