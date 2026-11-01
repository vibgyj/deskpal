"""deskpal reference proxy for Python 3.9+, a port of ../node/deskpal-proxy.mjs.

The page never holds an API key: the widget calls these routes on your own
server, which add the key, fix the model and limits, and refuse misuse.

    POST …/embed                  question vectors for `embedEndpoint`
    POST …/llm/chat/completions   OpenAI-compatible writer (`openai-compatible`)
    POST …/claude                 Claude Messages API writer (`anthropic`)

Routes match by suffix, so mount them under any path. `app` is a WSGI
application (Flask, Django and most servers can mount it); run this file to
serve it alone on PORT (default 8788). Settings come from environment
variables (see ../README.md). The writers need only the standard library;
embedding needs `pip install -r requirements.txt`.

Limits live in this process: run one process (threads are fine, e.g.
`gunicorn -w 1 --threads 16 deskpal_proxy:app`), or each worker counts alone.
"""

import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from datetime import datetime, timezone
from socketserver import ThreadingMixIn
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server

# Models an index can be built with (`deskpal build-index --model`).
EMBED_MODELS = {
    "bge-small-en-v1.5": {"id": "Xenova/bge-small-en-v1.5", "dim": 384},
    "bge-base-en-v1.5": {"id": "Xenova/bge-base-en-v1.5", "dim": 768},
}
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "
ANTHROPIC_VERSION = "2026-10-21"
ANTHROPIC_BETAS = {"server-side-fallback-2026-07-01"}

MAX_TEXTS = 32
MAX_TEXT_CHARS = 1000
MAX_MESSAGES = 20
MAX_BODY = 64_000


def config_from_env(env=os.environ):
    """Settings from environment variables; every one has a default."""
    n = lambda k, d: float(env[k]) if env.get(k) else d
    openai = None
    if env.get("OPENAI_API_KEY") or env.get("OPENAI_BASE_URL"):
        openai = {
            "key": env.get("OPENAI_API_KEY", ""),
            "base_url": env.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
            "model": env.get("OPENAI_MODEL", "gpt-5-mini"),
            "max_tokens": int(n("OPENAI_MAX_TOKENS", 2000)),
        }
    anthropic = None
    if env.get("ANTHROPIC_API_KEY"):
        anthropic = {
            "key": env["ANTHROPIC_API_KEY"],
            "base_url": env.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/"),
            "model": env.get("CLAUDE_MODEL", "claude-opus-5-5"),
            "max_tokens": int(n("CLAUDE_MAX_TOKENS", 1024)),
        }
    embed = env.get("EMBED_MODEL", "bge-small-en-v1.5")
    return {
        "openai": openai,
        "anthropic": anthropic,
        "embed_model": None if embed == "off" else embed,
        "allowed_origins": [s.strip() for s in env["ALLOWED_ORIGINS"].split(",")] if env.get("ALLOWED_ORIGINS") else None,
        "trust_proxy": env.get("TRUST_PROXY") == "1",
        "limits": {
            "embed_per_minute": n("LIMIT_EMBED_PER_MIN", 20),
            "llm_per_minute": n("LIMIT_LLM_PER_MIN", 4),
            "llm_per_day": n("LIMIT_LLM_PER_DAY", 60),
            "site_llm_per_day": n("LIMIT_SITE_LLM_PER_DAY", 1000),
        },
    }


def create_proxy(config=None):
    """The proxy as a WSGI app. Paths that aren't its routes get a 404."""
    config = config or config_from_env()
    limiter = Limiter(config["limits"])
    embedder = Embedder(config["embed_model"]) if config["embed_model"] else None
    streaming = set()
    streaming_lock = threading.Lock()

    def app(environ, start_response):
        def send(status, obj, headers=()):
            start_response(STATUS[status], [("content-type", "application/json"), ("cache-control", "no-store"), *headers])
            return [json.dumps(obj).encode()]

        def too_many(wait):
            return send(429, {"error": "too many requests"}, [("retry-after", str(wait))])

        path = environ.get("PATH_INFO", "")
        route = "embed" if path.endswith("/embed") else "openai" if path.endswith("/llm/chat/completions") else "claude" if re.search(r"/claude(/v1/messages)?$", path) else None
        if not route:
            return send(404, {"error": "not found"})
        if environ["REQUEST_METHOD"] != "POST":
            return send(405, {"error": "POST only"})
        if not same_site(environ, config["allowed_origins"]):
            return send(403, {"error": "cross-site request"})
        if (route == "embed" and not embedder) or (route == "openai" and not config["openai"]) or (route == "claude" and not config["anthropic"]):
            return send(404, {"error": "not enabled"})
        ip = client_ip(environ, config["trust_proxy"])
        body = read_json(environ)
        if body is TOO_BIG:
            return send(413, {"error": "too large"})

        if route == "embed":
            texts = body.get("texts") if isinstance(body, dict) else None
            if not isinstance(texts, list) or not texts or len(texts) > MAX_TEXTS or not all(isinstance(t, str) for t in texts):
                return send(400, {"error": "bad request"})
            wait = limiter.take("embed", ip)
            if wait:
                return too_many(wait)
            vectors = embedder.embed([t[:MAX_TEXT_CHARS] for t in texts])
            if vectors is None:
                return send(503, {"error": "busy"}, [("retry-after", "5")])
            return send(200, {"model": embedder.model["id"], "vectors": vectors})

        upstream = openai_request(config["openai"], body) if route == "openai" else claude_request(config["anthropic"], body, environ)
        if not upstream:
            return send(400, {"error": "bad request"})
        # One answer at a time per visitor, then the visitor's and the site's budgets.
        with streaming_lock:
            if ip in streaming:
                return too_many(5)
            wait = limiter.take("llm", ip) or limiter.take_site()
            if wait:
                return too_many(wait)
            streaming.add(ip)
        try:
            req = urllib.request.Request(upstream["url"], data=json.dumps(upstream["body"]).encode(), headers=upstream["headers"], method="POST")
            try:
                resp = urllib.request.urlopen(req, timeout=120)
            except urllib.error.HTTPError as err:
                resp = err  # an error reply is passed on as it is
        except Exception as err:  # noqa: BLE001 - any failure upstream is a 502
            with streaming_lock:
                streaming.discard(ip)
            print("deskpal proxy:", err)
            return send(502, {"error": "upstream failed"})
        start_response(STATUS.get(resp.status, f"{resp.status} Upstream"), [("content-type", resp.headers.get("content-type", "text/event-stream")), ("cache-control", "no-store")])
        return stream(resp, lambda: discard(ip))

    def discard(ip):
        with streaming_lock:
            streaming.discard(ip)

    return app


def stream(resp, done):
    """Passes the reply on as it arrives. When the visitor leaves, the server
    closes this generator, which closes the upstream call too."""
    try:
        while True:
            chunk = resp.read1(65536) if hasattr(resp, "read1") else resp.read(65536)
            if not chunk:
                break
            yield chunk
    finally:
        resp.close()
        done()


# ---- writers ---------------------------------------------------------------


def valid_messages(messages, roles):
    return (
        isinstance(messages, list)
        and 0 < len(messages) <= MAX_MESSAGES
        and all(isinstance(m, dict) and m.get("role") in roles and isinstance(m.get("content"), str) for m in messages)
    )


def openai_request(cfg, body):
    """Only the messages pass through; the model and the length cap are the server's."""
    if not isinstance(body, dict) or not valid_messages(body.get("messages"), ("system", "user", "assistant")):
        return None
    messages = [{"role": m["role"], "content": m["content"]} for m in body["messages"]]
    # OpenAI's own API wants max_completion_tokens; other servers (Ollama, vLLM) max_tokens.
    cap_field = "max_completion_tokens" if "api.openai.com" in cfg["base_url"] else "max_tokens"
    headers = {"content-type": "application/json"}
    if cfg["key"]:
        headers["authorization"] = f"Bearer {cfg['key']}"
    return {"url": f"{cfg['base_url']}/chat/completions", "headers": headers, "body": {"model": cfg["model"], "messages": messages, "stream": True, cap_field: cfg["max_tokens"]}}


def claude_request(cfg, body, environ):
    """The widget's Messages API request, with the server's model and cap, and only the fields it uses."""
    if not isinstance(body, dict) or not valid_messages(body.get("messages"), ("user", "assistant")):
        return None
    if body.get("system") is not None and not isinstance(body["system"], str):
        return None
    try:
        asked = int(body.get("max_tokens") or cfg["max_tokens"])
    except (TypeError, ValueError):
        asked = cfg["max_tokens"]
    out = {
        "model": cfg["model"],
        "max_tokens": max(1, min(asked, cfg["max_tokens"])),
        "stream": True,
        "messages": [{"role": m["role"], "content": m["content"]} for m in body["messages"]],
    }
    if body.get("system"):
        out["system"] = body["system"]
    effort = (body.get("output_config") or {}).get("effort") if isinstance(body.get("output_config"), dict) else None
    if effort in ("low", "medium", "high"):
        out["output_config"] = {"effort": effort}
    if body.get("fallbacks") == "default":
        out["fallbacks"] = "default"
    version = environ.get("HTTP_ANTHROPIC_VERSION", "")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", version):
        version = ANTHROPIC_VERSION
    betas = [b.strip() for b in environ.get("HTTP_ANTHROPIC_BETA", "").split(",") if b.strip() in ANTHROPIC_BETAS]
    headers = {"content-type": "application/json", "x-api-key": cfg["key"], "anthropic-version": version}
    if betas:
        headers["anthropic-beta"] = ",".join(betas)
    return {"url": f"{cfg['base_url']}/v1/messages", "headers": headers, "body": out}


# ---- question embeddings ---------------------------------------------------


class Embedder:
    """The same ONNX file and tokenizer the widget uses (transformers.js, q8),
    run with onnxruntime, so vectors match the index."""

    def __init__(self, name):
        if name not in EMBED_MODELS:
            raise ValueError(f'deskpal proxy: unknown EMBED_MODEL "{name}"; choose {" or ".join(EMBED_MODELS)}')
        self.model = EMBED_MODELS[name]
        self.lock = threading.Lock()
        self.waiting = 0
        self.waiting_lock = threading.Lock()
        self.cache = OrderedDict()
        self.session = None

    def load(self):
        import numpy  # noqa: F401 - fail early with a clear message
        import onnxruntime
        from tokenizers import Tokenizer

        folder = os.path.join(os.environ.get("DESKPAL_MODEL_CACHE", os.path.expanduser("~/.cache/deskpal")), self.model["id"])
        os.makedirs(folder, exist_ok=True)
        files = {}
        for name in ("onnx/model_quantized.onnx", "tokenizer.json"):
            local = os.path.join(folder, name.replace("/", "_"))
            if not os.path.exists(local):
                url = f"https://huggingface.co/{self.model['id']}/resolve/main/{name}"
                urllib.request.urlretrieve(url, local + ".part")
                os.replace(local + ".part", local)
            files[name] = local
        self.tokenizer = Tokenizer.from_file(files["tokenizer.json"])
        self.tokenizer.enable_truncation(512)
        self.tokenizer.enable_padding()
        self.session = onnxruntime.InferenceSession(files["onnx/model_quantized.onnx"], providers=["CPUExecutionProvider"])
        self.inputs = {i.name for i in self.session.get_inputs()}

    def embed(self, texts):
        """Vectors for the texts, or None when too many requests are already waiting."""
        with self.waiting_lock:
            if self.waiting >= 20:
                return None
            self.waiting += 1
        try:
            # One model call at a time: the CPU is the limit, and it keeps memory flat.
            with self.lock:
                return self.run(texts)
        finally:
            with self.waiting_lock:
                self.waiting -= 1

    def run(self, texts):
        import numpy as np

        if self.session is None:
            self.load()
        missing = list(dict.fromkeys(t for t in texts if t not in self.cache))
        if missing:
            enc = self.tokenizer.encode_batch([QUERY_PREFIX + t for t in missing])
            feed = {
                "input_ids": np.array([e.ids for e in enc], dtype=np.int64),
                "attention_mask": np.array([e.attention_mask for e in enc], dtype=np.int64),
                "token_type_ids": np.array([e.type_ids for e in enc], dtype=np.int64),
            }
            hidden = self.session.run(None, {k: v for k, v in feed.items() if k in self.inputs})[0]
            # CLS pooling, then unit length: as the widget does.
            cls = hidden[:, 0, :]
            cls = cls / np.linalg.norm(cls, axis=1, keepdims=True)
            for t, v in zip(missing, cls):
                self.cache[t] = [round(float(x), 6) for x in v]
            # Small LRU: common questions and the widget's small-talk examples stay warm.
            while len(self.cache) > 2000:
                self.cache.popitem(last=False)
        for t in texts:
            self.cache.move_to_end(t)
        return [self.cache[t] for t in texts]


# ---- limits ----------------------------------------------------------------


def today():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def seconds_to_midnight():
    now = datetime.now(timezone.utc)
    return 86400 - (now.hour * 3600 + now.minute * 60 + now.second)


class Limiter:
    """Token buckets per visitor, and a daily count for the whole site."""

    def __init__(self, limits):
        self.limits = limits
        self.buckets = {}
        self.site = {"day": "", "count": 0}
        self.lock = threading.Lock()

    def take(self, kind, ip):
        """Takes a token, or returns the seconds to wait."""
        per_minute = self.limits["embed_per_minute"] if kind == "embed" else self.limits["llm_per_minute"]
        per_day = 0 if kind == "embed" else self.limits["llm_per_day"]
        now = time.time()
        day = today()
        with self.lock:
            # Forget visitors idle for an hour, so the table doesn't grow without end.
            if len(self.buckets) > 10_000:
                self.buckets = {k: b for k, b in self.buckets.items() if now - b["at"] < 3600}
            b = self.buckets.setdefault(f"{kind} {ip}", {"tokens": per_minute, "at": now, "day": day, "used": 0})
            b["tokens"] = min(per_minute, b["tokens"] + (now - b["at"]) / 60 * per_minute)
            b["at"] = now
            if b["day"] != day:
                b.update(day=day, used=0)
            if per_day and b["used"] >= per_day:
                return seconds_to_midnight()
            if b["tokens"] < 1:
                return max(1, int(-(-(1 - b["tokens"]) / per_minute * 60 // 1)))
            b["tokens"] -= 1
            b["used"] += 1
            return 0

    def take_site(self):
        with self.lock:
            if self.site["day"] != today():
                self.site = {"day": today(), "count": 0}
            if self.site["count"] >= self.limits["site_llm_per_day"]:
                return seconds_to_midnight()
            self.site["count"] += 1
            return 0


# ---- HTTP helpers ----------------------------------------------------------

STATUS = {200: "200 OK", 400: "400 Bad Request", 403: "403 Forbidden", 404: "404 Not Found", 405: "405 Method Not Allowed", 413: "413 Payload Too Large", 429: "429 Too Many Requests", 500: "500 Internal Server Error", 502: "502 Bad Gateway", 503: "503 Service Unavailable"}
TOO_BIG = object()


def same_site(environ, allowed):
    """Pages on other sites can't spend your budget: their Origin isn't yours."""
    origin = environ.get("HTTP_ORIGIN")
    if not origin:
        return True  # not a browser page: the rate limits apply
    if allowed:
        return origin in allowed
    host = re.sub(r"^[a-z]+://", "", origin, flags=re.I).split("/")[0]
    return host == environ.get("HTTP_HOST")


def client_ip(environ, trust_proxy):
    """The socket's address; behind your own reverse proxy, the last X-Forwarded-For hop it added."""
    if trust_proxy:
        hops = [h.strip() for h in environ.get("HTTP_X_FORWARDED_FOR", "").split(",") if h.strip()]
        if hops:
            return hops[-1]
    return environ.get("REMOTE_ADDR", "unknown")


def read_json(environ):
    try:
        length = int(environ.get("CONTENT_LENGTH") or 0)
    except ValueError:
        length = 0
    if length > MAX_BODY:
        return TOO_BIG
    data = environ["wsgi.input"].read(length) if length else b""
    try:
        return json.loads(data or b"null")
    except ValueError:
        return None


app = create_proxy()


class _Server(ThreadingMixIn, WSGIServer):
    daemon_threads = True


class _Quiet(WSGIRequestHandler):
    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8788"))
    cfg = config_from_env()
    on = [f"embed ({cfg['embed_model']})" if cfg["embed_model"] else "", f"llm ({cfg['openai']['model']})" if cfg["openai"] else "", f"claude ({cfg['anthropic']['model']})" if cfg["anthropic"] else ""]
    print(f"deskpal proxy on http://localhost:{port}: {', '.join(x for x in on if x) or 'nothing enabled'}", flush=True)
    make_server("", port, app, server_class=_Server, handler_class=_Quiet).serve_forever()
