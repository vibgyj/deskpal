# Models

deskpal first finds the doc sections that match a question. Then a model
answers from those sections only, and links to them.

## Answers on your device

By default deskpal answers in the visitor's browser. It finds the answer inside
your docs and shows it highlighted in its section, so it never makes anything
up. The first time someone asks a question, it offers to download about
110 MB of model files once, which the browser keeps in its cache. After that,
nothing they type leaves their device.

If they say no, deskpal shows the matching doc sections instead.

## Retrieval only

With `adapter: "none"` there is no answer model at all. The answer is the
matching doc sections themselves, with links. It is fast and still useful.

## Ollama, llama.cpp and cloud models

The `openai-compatible` adapter writes answers with any server that offers
`/v1/chat/completions` and streams. That can be a model on your own machine,
such as Ollama, llama.cpp server or vLLM, or a hosted cloud model:

```json
{
  "adapter": "openai-compatible",
  "endpoint": "http://localhost:11434/v1",
  "model": "qwen3:0.6b"
}
```

This sends the question and the matching doc sections to that server, so it is
not private by default. Do not put a secret API key in the page: every visitor
can read it. For a cloud model, point `endpoint` at your own proxy that adds the
key on the server.

## The reference proxy

deskpal comes with a proxy for your server, in Node, Python and PHP
(`proxy/` in the package; see its README). It serves all three things a
widget may need from your server: question embeddings (`embedEndpoint`), an
OpenAI-compatible writer, and Claude. It keeps the key on the server and
picks the model and the answer length. Requests from other sites are
refused, and each visitor is rate-limited, with a daily cap for the whole
site, so the endpoint can't run up your bill:

```json
{
  "embedEndpoint": "/api/deskpal/embed",
  "adapter": "openai-compatible",
  "endpoint": "/api/deskpal/llm"
}
```

## Embedding questions on your server

To match a question by meaning, deskpal turns it into a vector with the same
model the index was built with. By default that model runs in the visitor's
browser, which means a download of 34 MB (bge-small) or 110 MB (bge-base)
before the first answer, even when a cloud model writes the answers.

With `embedEndpoint`, your server embeds questions instead, and visitors
download nothing:

```json
{
  "index": "/deskpal-index.json",
  "embedEndpoint": "/api/embed",
  "adapter": "openai-compatible",
  "endpoint": "/api/llm"
}
```

deskpal sends a `POST` with JSON `{"texts": ["how much does it cost?"]}`, up
to 32 texts, and expects `{"model": "<model id>", "vectors": [[...], ...]}`
back: one vector per text. Your server applies the model's query prefix, and
`model` must be the id in the index (`Xenova/bge-base-en-v1.5`, say). Embed
with `embedAll(extractor, model, texts.map((t) => queryText(model, t)))` from
deskpal's `src/rag/embedding.ts` and the vectors match the index exactly.

The [reference proxy](#the-reference-proxy) does all of this. The questions
go to your server, so this is not private in the way on-device answers are.
Limit the endpoint as you would any public API: cap the text
length and texts per request, rate-limit per visitor, and refuse requests
whose `Origin` is another site. When the endpoint fails or answers 429,
deskpal falls back to keyword search for that question.

## Claude

The `anthropic` adapter writes answers with Claude through the Messages API,
streamed. The page never holds your API key: `endpoint` is a small proxy on
your server that adds it.

```json
{
  "adapter": "anthropic",
  "endpoint": "/api/claude"
}
```

`model` defaults to `claude-opus-5-5`. The adapter asks for low effort, since
it answers in a sentence or two from the sections it is given, and turns on
the API's refusal fallback for the models that support it. If Claude declines
or the request fails, deskpal shows the matching doc sections instead.

A proxy can be this small. This one is a fetch handler, as used by Cloudflare
Workers, Deno and Bun. It passes on only the fields deskpal sends, and pins the
model and length so the endpoint can't be used for anything else:

```js
const ALLOWED = ['stream', 'system', 'messages', 'output_config', 'fallbacks'];

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const sent = await request.json();
    const body = { model: 'claude-opus-5-5', max_tokens: 1024 };
    for (const key of ALLOWED) if (key in sent) body[key] = sent[key];
    const headers = {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2026-10-21',
    };
    const beta = request.headers.get('anthropic-beta');
    if (beta) headers['anthropic-beta'] = beta;
    return fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
  },
};
```

Anyone can call your proxy, so add rate limiting and check the `Origin` header
before you rely on it, or use [the reference proxy](#the-reference-proxy),
which does both.

## Your own backend

The `custom` adapter hands the question to a function you pass to `init()`,
so you can use any API, your own server or your own sign-in. It gets the
ready-made prompt, plus the raw question and matching sections if you'd
rather build your own. Return the answer as text, a promise of text, or an
async iterable of text pieces to stream it:

```html
<script defer src="/deskpal.js" data-auto="false"></script>
<script type="module">
  addEventListener('load', () =>
    deskpal.init({
      index: '/deskpal-index.json',
      adapter: 'custom',
      async generate(prompt, signal) {
        const res = await fetch('/api/ask', {
          method: 'POST',
          signal,
          body: JSON.stringify({ question: prompt.question, sources: prompt.sources }),
        });
        return res.text();
      },
    }),
  );
</script>
```

`prompt.messages` is a system message (the instructions and numbered sources)
then the question, ready for most chat APIs. Cite sources as `[1]`, `[2]` and
deskpal links the sections you cite. Answer "I don't know that one" and it
shows its own reply and the closest sections. If your function throws, it
shows the matching sections.

The inline script above needs a CSP that allows it (a nonce or hash), unlike
the rest of deskpal.
