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
