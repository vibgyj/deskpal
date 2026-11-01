# deskpal reference proxy

deskpal runs in the visitor's browser, so anything in the page is public,
including an API key. When a cloud model writes the answers, or your server
embeds the questions, the widget calls a small proxy on your own site instead.
The proxy adds the key and picks the model, and it refuses misuse.

The same proxy comes in three versions with the same behaviour, checked by one
shared test:

| | File | Needs |
|---|---|---|
| Node | `node/deskpal-proxy.mjs` | Node 22.18+; `@huggingface/transformers` to embed |
| Python | `python/deskpal_proxy.py` | Python 3.9+; `pip install -r requirements.txt` to embed |
| PHP | `php/deskpal-proxy.php` | PHP 8.1+ with curl; embedding goes to the Node or Python proxy |

## Routes

All are `POST`. They match by the end of the path, so mount them anywhere,
such as under `/api/deskpal/`.

| Route | For the widget's | Upstream |
|---|---|---|
| `…/embed` | `embedEndpoint` | the embedding model, on this server |
| `…/llm/chat/completions` | `adapter: "openai-compatible"`, `endpoint: "…/llm"` | OpenAI, or any OpenAI-compatible server |
| `…/claude` | `adapter: "anthropic"`, `endpoint: "…/claude"` | the Claude Messages API |

A widget set up for all three:

```json
{
  "index": "/deskpal-index.json",
  "embedEndpoint": "/api/deskpal/embed",
  "adapter": "openai-compatible",
  "endpoint": "/api/deskpal/llm"
}
```

## What it lets through

- **Writers:**
  - Only the messages pass: their role and text, at most 20, and 64 KB per request.
  - The model, the answer length cap and the key come from the server.
  - For Claude, the widget's `effort`, the `fallbacks` setting and the fallback beta header pass too. Nothing else does, so a visitor can't add tools or pick a bigger model.
- **Embedding:** up to 32 texts per request, each cut to 1,000 characters. The reply is `{"model": "<id>", "vectors": [[…], …]}`.
  - Node and Python run the same ONNX file and tokenizer as the widget, so vectors match the index. The shared test checks a cosine above 0.999.
  - Common questions are cached.
  - One embedding runs at a time; once 20 are waiting, the reply is 503.
- **Limits, per visitor:**

  | Limit | Default | Setting |
  |---|---|---|
  | Embedding requests | 20 a minute (also the burst size) | `LIMIT_EMBED_PER_MIN` |
  | Answers | 4 a minute | `LIMIT_LLM_PER_MIN` |
  | Answers | 60 a day | `LIMIT_LLM_PER_DAY` |
  | Answers at once | one; asking again while one streams gets 429 | |

  Over a limit, the reply is 429 with `Retry-After`. The widget then falls back:
  - When embedding is limited, it uses keyword search.
  - When an answer is limited, it shows the matching sections.
- **Limit for the whole site:** 1,000 answers a day (`LIMIT_SITE_LLM_PER_DAY`). This is the cap on your bill if someone spreads requests over many addresses.
- **Other sites:** a request whose `Origin` is a different site gets 403, so their pages can't spend your budget. Set `ALLOWED_ORIGINS` to a comma-separated list for anything unusual.
- **Leaving early:** when the visitor closes the page or asks something new, the upstream call stops too, and the rest of the answer isn't paid for.

Visitors are told apart by IP address. Behind your own reverse proxy or CDN,
set `TRUST_PROXY=1` to use the last `X-Forwarded-For` hop instead, and only
then: otherwise anyone can claim any address.

## Settings

All three read the same environment variables.

| Variable | Default | |
|---|---|---|
| `OPENAI_API_KEY` | | turns on `…/llm` |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | or Ollama (`http://localhost:11434/v1`, no key needed), vLLM… |
| `OPENAI_MODEL` | `gpt-5-mini` | |
| `OPENAI_MAX_TOKENS` | 2000 | sent as `max_completion_tokens` to OpenAI, `max_tokens` elsewhere |
| `ANTHROPIC_API_KEY` | | turns on `…/claude` |
| `CLAUDE_MODEL` | `claude-opus-5-5` | set the widget's `model` the same |
| `CLAUDE_MAX_TOKENS` | 1024 | caps what the widget asks for |
| `EMBED_MODEL` | `bge-small-en-v1.5` | Node and Python: the index's model, or `off` |
| `EMBED_URL` | | PHP: the Node or Python proxy's `/embed`, which turns on `…/embed` |
| `LIMIT_EMBED_PER_MIN` | 20 | |
| `LIMIT_LLM_PER_MIN` | 4 | |
| `LIMIT_LLM_PER_DAY` | 60 | |
| `LIMIT_SITE_LLM_PER_DAY` | 1000 | |
| `ALLOWED_ORIGINS` | the request's own host | |
| `TRUST_PROXY` | off | `1` behind your own reverse proxy |
| `PORT` | 8788 | Node and Python, when run alone |
| `DESKPAL_MODEL_CACHE` | `~/.cache/deskpal` | Python: where model files are kept |
| `DESKPAL_STATE_DIR` | system temp folder | PHP: where the limits file is kept |

## Running it

**Node**, alone or inside your own server:

```sh
OPENAI_API_KEY=sk-… EMBED_MODEL=bge-base-en-v1.5 node proxy/node/deskpal-proxy.mjs
```

```js
import { createProxy } from 'deskpal/proxy';
const proxy = createProxy(); // settings from the environment, or pass configFromEnv({...})
http.createServer(async (req, res) => {
  if (await proxy(req, res)) return; // one of its routes
  // …the rest of your site
});
```

**Python**: `app` is a WSGI app. Run the file alone, or serve it with
gunicorn, or mount it in Flask or Django:

```sh
pip install -r proxy/python/requirements.txt   # only for embedding
OPENAI_API_KEY=sk-… python proxy/python/deskpal_proxy.py
gunicorn -w 1 --threads 16 --chdir proxy/python deskpal_proxy:app
```

The limits are kept in memory. Run one process, with as many threads as you
like; with several processes, each one counts on its own.

**PHP**: copy `deskpal-proxy.php` to `/api/deskpal.php`, set the variables in
your server config (`SetEnv` or `fastcgi_param`, for example), and point the
widget at `/api/deskpal.php/embed` and `/api/deskpal.php/llm`. Embedding needs
the Node or Python proxy running next to it, reachable only from the machine:

```sh
EMBED_MODEL=bge-base-en-v1.5 LIMIT_EMBED_PER_MIN=1000 PORT=8789 python proxy/python/deskpal_proxy.py
# and for PHP: EMBED_URL=http://127.0.0.1:8789/embed
```

PHP applies the per-visitor limits itself. The sidecar sees only PHP's own
address, which is why its limit is raised.

Behind nginx, turn off response buffering for these routes
(`proxy_buffering off`), or answers arrive all at once at the end.
`X-Accel-Buffering: no` is already sent.

## Testing

```sh
npm run test:proxy            # Node, Python and PHP, whichever are installed
node proxy/test/conformance.mjs python --embed   # also checks the vectors
```

The test runs each proxy against a fake OpenAI and Anthropic server, so it
needs no keys and costs nothing.
