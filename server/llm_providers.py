"""AI part naming: provider settings and one request to the provider the user picked.

Shared by the local server (server/llm_review.py) and the OrcaSlicer plugin (plugin/build.py inlines this file),
so both send the same request. Standard library only. Nothing here runs unless the user clicks Name parts, and
the request goes only to the chosen provider's base URL.

Providers:
  openrouter  https://openrouter.ai/api/v1   OpenAI-style chat completions, key required
  openai      https://api.openai.com/v1      OpenAI chat completions, key required
  anthropic   https://api.anthropic.com/v1   Anthropic Messages API, key required
  custom      any OpenAI-compatible base URL (LM Studio, Ollama, llama.cpp, vLLM, ...), key optional

Settings store (a JSON file the caller loads and saves):
  {"provider": "custom", "providers": {"custom": {"base_url": "...", "model": "...", "api_key": "..."}, ...}}
"""
import json
import re
import socket
import time
import urllib.error
import urllib.request

PROVIDERS = {
    "openrouter": {"label": "OpenRouter", "api": "openai", "base_url": "https://openrouter.ai/api/v1",
                   "needs_key": True, "model": "deepseek/deepseek-v4.1-flash", "env": "OPENROUTER_API_KEY"},
    "openai": {"label": "OpenAI", "api": "openai", "base_url": "https://api.openai.com/v1",
               "needs_key": True, "model": "gpt-5-mini", "env": "OPENAI_API_KEY"},
    "anthropic": {"label": "Anthropic Claude", "api": "anthropic", "base_url": "https://api.anthropic.com/v1",
                  "needs_key": True, "model": "claude-opus-5-5", "env": "ANTHROPIC_API_KEY"},
    "custom": {"label": "Custom or local", "api": "openai", "base_url": "http://localhost:1234/v1",
               "needs_key": False, "model": "", "env": "MESH_SPLITTER_LLM_KEY"},
}
DEFAULT_PROVIDER = "openrouter"
MAX_IMAGES = 6
# Seconds. FIRST_BYTE: no reply at all (the server or a proxy is stuck). TOTAL: the whole answer, streamed.
# A local model on a GPU can take minutes to read the pictures, so custom servers get longer limits.
LIMITS = {"cloud": {"first_byte": 90, "total": 300}, "local": {"first_byte": 300, "total": 900}}
TIMEOUT = LIMITS["local"]["total"]

SYSTEM = """You review a 3D mesh that a user split into parts for multi-color / multi-piece 3D printing (FDM).
You get rendered views (each part drawn in its own color, labeled #id) and per-part stats as JSON.
Tasks:
1. Name each part with a short, specific noun phrase (e.g. "left boot", "broom head", "helmet visor"). Use the object's context.
2. Flag obvious segmentation problems: a part that bleeds into a neighbor, one real feature split across parts, stray fragments/islands,
   tiny slivers, faces left Unassigned, or a cut through a thin feature that will be hard to print or glue.
Only flag what the images or stats support. Say which part ids are involved and a concrete fix using the app's tools
(add a seed to part #n and re-segment, Fill, Brush, Merge, Smooth, Auto split active part).
Reply with JSON only, no prose, matching:
{"object": "what the whole model is", "parts": [{"id": 1, "name": "...", "confidence": 0.0-1.0}],
 "issues": [{"severity": "high|medium|low", "parts": [1, 2], "problem": "...", "fix": "..."}], "summary": "one sentence"}"""


# ---------------------------------------------------------------- settings

def clean_base_url(url):
    """'http://host:1234/v1/' or a pasted '.../v1/chat/completions' -> 'http://host:1234/v1'. Only http(s)."""
    url = str(url or "").strip().rstrip("/")
    url = re.sub(r"/(chat/completions|completions|messages|models)$", "", url)
    if not re.match(r"^https?://[^/\s]+", url, re.I):
        return ""
    return url


def resolve(store, env=None):
    """The active provider config from the saved store plus optional key overrides (env var name -> value).

    Returns {"provider", "label", "api", "base_url", "model", "api_key", "key_source"}.
    """
    store = store if isinstance(store, dict) else {}
    env = env or {}
    pid = store.get("provider") if store.get("provider") in PROVIDERS else None
    if pid is None:  # nothing saved: use the provider whose key is set, else the default
        pid = next((p for p, d in PROVIDERS.items() if d["needs_key"] and env.get(d["env"])), DEFAULT_PROVIDER)
    spec = PROVIDERS[pid]
    saved = (store.get("providers") or {}).get(pid) or {}
    key, source = "", None
    if env.get(spec["env"]):
        key, source = env[spec["env"]], env.get("_source", "env")
    elif saved.get("api_key"):
        key, source = saved["api_key"], "saved"
    base = clean_base_url(saved.get("base_url")) if pid == "custom" else spec["base_url"]
    model = (env.get("OPENROUTER_MODEL") if pid == "openrouter" else "") or saved.get("model") or spec["model"]
    return {"provider": pid, "label": spec["label"], "api": spec["api"], "base_url": base or spec["base_url"],
            "model": str(model).strip(), "api_key": str(key).strip(), "key_source": source}


def status(store, env=None):
    """What the page may see: everything but the key itself."""
    cfg = resolve(store, env)
    spec = PROVIDERS[cfg["provider"]]
    ready = bool(cfg["api_key"]) or not spec["needs_key"]
    return {"configured": ready, "provider": cfg["provider"], "label": cfg["label"], "base_url": cfg["base_url"],
            "model": cfg["model"], "has_key": bool(cfg["api_key"]), "source": cfg["key_source"],
            "needs_key": spec["needs_key"],
            "providers": [{"id": p, "label": d["label"], "needs_key": d["needs_key"], "model": d["model"],
                           "base_url": d["base_url"]} for p, d in PROVIDERS.items()]}


def update(store, patch):
    """Apply a settings change from the page. An empty api_key keeps the saved key; clear_key removes it."""
    store = dict(store) if isinstance(store, dict) else {}
    patch = patch if isinstance(patch, dict) else {}
    pid = patch.get("provider")
    if pid not in PROVIDERS:
        raise ValueError(f"unknown provider: {pid}")
    providers = dict(store.get("providers") or {})
    cur = dict(providers.get(pid) or {})
    if "model" in patch:
        cur["model"] = str(patch.get("model") or "").strip()[:200]
    if pid == "custom" and "base_url" in patch:
        url = clean_base_url(patch.get("base_url"))
        if patch.get("base_url") and not url:
            raise ValueError("Base URL must start with http:// or https://")
        cur["base_url"] = url
    if patch.get("clear_key"):
        cur.pop("api_key", None)
    elif str(patch.get("api_key") or "").strip():
        cur["api_key"] = str(patch["api_key"]).strip()
    providers[pid] = cur
    store["provider"], store["providers"] = pid, providers
    return store


# ---------------------------------------------------------------- request

def opener_for(url):
    """urlopen, but never through a proxy for a server on this computer (a system proxy can't reach it)."""
    if re.match(r"^https?://(localhost|127\.[\d.]+|\[::1\])(:\d+)?(/|$)", url, re.I):
        return urllib.request.build_opener(urllib.request.ProxyHandler({})).open
    return urllib.request.urlopen


def extract_json(text):
    """Model replies are usually JSON, sometimes fenced or wrapped in prose (or after a <think> block)."""
    text = re.sub(r"<think>.*?</think>", "", str(text or ""), flags=re.S).strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if m:
        text = m.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        a, b = text.find("{"), text.rfind("}")
        if a >= 0 and b > a:
            return json.loads(text[a: b + 1])
        raise


def user_parts(body):
    """[('text', str) | ('image', data_url)] in the order the model should see them."""
    images = [i for i in body.get("images") or [] if isinstance(i, str) and i.startswith("data:image/")][:MAX_IMAGES]
    captions = body.get("captions") or []
    out = [("text", "Part stats:\n" + json.dumps(body.get("stats") or {}, separators=(",", ":")))]
    for i, img in enumerate(images):
        if i < len(captions):
            out.append(("text", str(captions[i])[:200]))
        out.append(("image", img))
    hint = str(body.get("hint") or "").strip()
    if hint:
        out.append(("text", "User note: " + hint[:500]))
    return out


def build_messages(body):
    """OpenAI chat-completions messages (also what OpenRouter and local servers take)."""
    content = [{"type": "text", "text": v} if k == "text" else {"type": "image_url", "image_url": {"url": v}}
               for k, v in user_parts(body)]
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": content}]


def anthropic_content(body):
    out = []
    for k, v in user_parts(body):
        if k == "text":
            out.append({"type": "text", "text": v})
        else:
            m = re.match(r"data:(image/[\w.+-]+);base64,(.*)$", v, re.S)
            if m:
                out.append({"type": "image", "source": {"type": "base64", "media_type": m.group(1), "data": m.group(2)}})
    return out


def build_request(cfg, body):
    """(url, headers, payload) for the provider in cfg. The model in body wins over the saved one."""
    model = str(body.get("model") or cfg["model"] or "").strip()
    headers = {"Content-Type": "application/json"}
    if cfg["api"] == "anthropic":
        headers.update({"x-api-key": cfg["api_key"], "anthropic-version": "2023-06-01"})
        payload = {"model": model, "max_tokens": 16000, "system": SYSTEM,
                   "messages": [{"role": "user", "content": anthropic_content(body)}],
                   "output_config": {"effort": "low"}, "stream": True}
        if re.match(r"claude-(opus-5|sonnet-5-5|fable-5)", model):
            # On a safety decline, let the API re-run the request on a fallback model instead of failing.
            headers["anthropic-beta"] = "server-side-fallback-2026-07-01"
            payload["fallbacks"] = "default"
        return cfg["base_url"] + "/messages", headers, payload
    if cfg["api_key"]:
        headers["Authorization"] = f"Bearer {cfg['api_key']}"
    payload = {"messages": build_messages(body), "stream": True}  # streamed: progress, and a stall is visible
    if model:
        payload["model"] = model  # a local server with one model loaded may not need it
    if cfg["provider"] in ("openrouter", "openai"):
        payload["response_format"] = {"type": "json_object"}  # local servers often reject json_object
        payload["stream_options"] = {"include_usage": True}
    if cfg["provider"] == "openrouter":
        payload["temperature"] = 0.2
        headers["X-Title"] = "Mesh Splitter"
    return cfg["base_url"] + "/chat/completions", headers, payload


def error_detail(raw):
    try:
        j = json.loads(raw)
        e = j.get("error") if isinstance(j, dict) else None
        return (e.get("message") if isinstance(e, dict) else e) or raw
    except (json.JSONDecodeError, AttributeError):
        return raw


def read_reply(cfg, resp):
    """(text, usage, model) from a provider response; raises ValueError on an unexpected shape."""
    if cfg["api"] == "anthropic":
        if resp.get("stop_reason") == "refusal":
            raise ValueError("The model declined this request")
        text = "".join(b.get("text", "") for b in resp.get("content") or [] if b.get("type") == "text")
        u = resp.get("usage") or {}
        usage = {"prompt_tokens": u.get("input_tokens"), "completion_tokens": u.get("output_tokens")}
        return text, usage, resp.get("model")
    try:
        text = resp["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        raise ValueError("Unexpected response")
    return text, resp.get("usage"), resp.get("model")


class Cancelled(Exception):
    pass


def limits(cfg):
    return LIMITS["local" if cfg["provider"] == "custom" else "cloud"]


def provider_name(cfg):
    return cfg["label"] if cfg["provider"] != "custom" else cfg["base_url"]


def mins(s):
    return f"{s // 60} min" if s >= 120 else f"{s} s"


class Stream:
    """Collects a streamed reply (OpenAI-style chat completion chunks or Anthropic Messages events)."""

    def __init__(self, cfg, progress):
        self.cfg, self.progress = cfg, progress
        self.text, self.reasoning, self.model, self.usage, self.stop = [], 0, None, None, None
        self.in_tokens = None
        self.chars = 0

    def tick(self, stage):
        self.progress(stage, {"chars": self.chars, "reasoning": self.reasoning})

    def event(self, d):
        if not isinstance(d, dict):
            return
        if d.get("error") or d.get("type") == "error":
            e = d.get("error") or d
            raise ValueError(str(e.get("message") if isinstance(e, dict) else e)[:400])
        if self.cfg["api"] == "anthropic":
            t = d.get("type")
            if t == "message_start":
                m = d.get("message") or {}
                self.model = m.get("model")
                self.in_tokens = (m.get("usage") or {}).get("input_tokens")
            elif t == "content_block_delta":
                dl = d.get("delta") or {}
                if dl.get("type") == "text_delta":
                    self.text.append(dl.get("text") or "")
                    self.chars += len(dl.get("text") or "")
                    self.tick("writing")
                elif dl.get("type") == "thinking_delta":
                    self.reasoning += len(dl.get("thinking") or "")
                    self.tick("thinking")
            elif t == "message_delta":
                self.stop = (d.get("delta") or {}).get("stop_reason") or self.stop
                u = d.get("usage") or {}
                self.usage = {"prompt_tokens": self.in_tokens, "completion_tokens": u.get("output_tokens")}
            return
        self.model = d.get("model") or self.model
        if d.get("usage"):
            self.usage = d["usage"]
        for ch in d.get("choices") or []:
            dl = ch.get("delta") or {}
            r = dl.get("reasoning") or dl.get("reasoning_content") or ""
            if r:
                self.reasoning += len(r)
                self.tick("thinking")
            if dl.get("content"):
                self.text.append(dl["content"])
                self.chars += len(dl["content"])
                self.tick("writing")
            if ch.get("finish_reason"):
                self.stop = ch["finish_reason"]


def read_stream(r, st, deadline, cancel, clock):
    """Read server-sent events until the end, the deadline or a cancel. Comment lines (': ...') keep-alive only."""
    data = []
    while True:
        if cancel():
            raise Cancelled()
        if clock() > deadline:
            raise TimeoutError("total")
        line = r.readline()
        if not line:
            break
        line = line.decode("utf-8", "replace").rstrip("\r\n")
        if line.startswith("data:"):
            data.append(line[5:].lstrip())
        elif not line and data:
            raw, data = "\n".join(data), []
            if raw.strip() == "[DONE]":
                break
            try:
                st.event(json.loads(raw))
            except json.JSONDecodeError:
                pass
    if cancel():
        raise Cancelled()
    if data and "\n".join(data).strip() != "[DONE]":
        try:
            st.event(json.loads("\n".join(data)))
        except json.JSONDecodeError:
            pass


def abort(r):
    """Stop a response that another thread is reading (Cancel): shut the socket so the blocked read returns."""
    try:  # only shutdown: closing the response under the reading thread breaks http.client
        r.fp.raw._sock.shutdown(socket.SHUT_RDWR)
    except Exception:
        pass


def call(cfg, body, opener=None, progress=None, cancel=None, on_response=None):
    """Send one naming request. Returns (http_status, {"ok", "result" | "error", ...}) for the page.

    progress(stage, info) is called as the request moves: "sending", "waiting" (connected, no answer yet),
    "thinking" / "writing" (streamed characters so far). cancel() returning True stops the request;
    on_response(r) gets the open response, so a Cancel from another thread can abort(r) a blocked read.
    The request gives up after LIMITS (no reply at all, or the whole answer too slow)."""
    progress = progress or (lambda stage, info: None)
    cancel = cancel or (lambda: False)
    clock = time.monotonic
    spec = PROVIDERS[cfg["provider"]]
    name = provider_name(cfg)
    if spec["needs_key"] and not cfg["api_key"]:
        return 400, {"ok": False, "error": f"No {cfg['label']} API key. Add one in AI settings."}
    if cfg["api"] == "openai" and cfg["provider"] != "custom" and not str(body.get("model") or cfg["model"]).strip():
        return 400, {"ok": False, "error": "Pick a model first."}
    lim = limits(cfg)
    url, headers, payload = build_request(cfg, body)
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    opener = opener or opener_for(url)
    start = clock()
    st = Stream(cfg, progress)
    hint = " Is the local server running?" if cfg["provider"] == "custom" else ""
    try:
        progress("sending", {"bytes": len(req.data)})
        with opener(req, timeout=lim["first_byte"]) as r:
            if on_response:
                on_response(r)
            progress("waiting", {})
            ctype = (getattr(r, "headers", None) or {}).get("Content-Type", "") or ""
            if "text/event-stream" in ctype:
                read_stream(r, st, start + lim["total"], cancel, clock)
                text = "".join(st.text)
                if not text and st.stop is None:
                    return 502, {"ok": False, "error": f"{name} closed the connection before answering. Try again."}
                if st.stop == "refusal":
                    return 502, {"ok": False, "error": f"{name}: The model declined this request"}
                usage, model = st.usage, st.model
            else:  # a server that ignores "stream" answers in one piece
                resp = json.loads(r.read().decode("utf-8"))
                if cancel():
                    raise Cancelled()
                if isinstance(resp, dict) and resp.get("error"):
                    err = resp["error"]
                    return 502, {"ok": False, "error": str(err.get("message") if isinstance(err, dict) else err)[:400]}
                text, usage, model = read_reply(cfg, resp)
    except Cancelled:
        return 499, {"ok": False, "cancelled": True, "error": "Cancelled"}
    except urllib.error.HTTPError as e:
        detail = error_detail(e.read().decode("utf-8", "replace"))
        return 502, {"ok": False, "error": f"{name} HTTP {e.code}: {str(detail)[:400]}"}
    except TimeoutError as e:
        if cancel():
            return 499, {"ok": False, "cancelled": True, "error": "Cancelled"}
        if str(e) == "total":
            return 504, {"ok": False, "error": f"Stopped after {mins(lim['total'])}: {name} was still answering. "
                                                "Try again, or pick a faster model."}
        if st.chars or st.reasoning:
            return 504, {"ok": False, "error": f"{name} stopped sending for {mins(lim['first_byte'])} mid-answer. "
                                                "Try again."}
        return 504, {"ok": False, "error": f"No answer from {name} in {mins(lim['first_byte'])}. "
                                            f"Try again, or pick another model.{hint}"}
    except (urllib.error.URLError, OSError) as e:
        if cancel():
            return 499, {"ok": False, "cancelled": True, "error": "Cancelled"}
        reason = getattr(e, "reason", e)
        if isinstance(reason, TimeoutError) or "timed out" in str(reason):
            return 504, {"ok": False, "error": f"No answer from {name} in {mins(lim['first_byte'])}. "
                                                f"Try again, or pick another model.{hint}"}
        return 502, {"ok": False, "error": f"{name} unreachable: {reason}.{hint}"}
    except (json.JSONDecodeError, UnicodeDecodeError):
        return 502, {"ok": False, "error": f"{name} did not return JSON"}
    except ValueError as e:  # an error event mid-stream, an unexpected reply shape, or a read after Cancel
        if cancel():
            return 499, {"ok": False, "cancelled": True, "error": "Cancelled"}
        return 502, {"ok": False, "error": f"{name}: {e}"}
    if st.stop == "length" or st.stop == "max_tokens":
        return 502, {"ok": False, "error": f"{name}: the answer was cut off (too long). Try again.", "raw": text[:2000]}
    try:
        result = extract_json(text)
    except json.JSONDecodeError:
        return 502, {"ok": False, "error": "Model did not return JSON", "raw": text[:2000]}
    return 200, {"ok": True, "model": model or payload.get("model") or "local model", "usage": usage, "result": result,
                 "seconds": round(clock() - start, 1)}


def check(cfg, opener=None):
    """Test the saved settings: can we reach the provider, does it take the key, does it offer the model?

    Returns {"ok", "error"?, "warning"?, "models": [...]}. Sends no model data."""
    name = provider_name(cfg)
    spec = PROVIDERS[cfg["provider"]]
    if spec["needs_key"] and not cfg["api_key"]:
        return {"ok": False, "error": f"Paste your {cfg['label']} API key first.", "models": []}
    headers = {}
    if cfg["api"] == "anthropic":
        headers = {"x-api-key": cfg["api_key"], "anthropic-version": "2023-06-01"}
    elif cfg["api_key"]:
        headers = {"Authorization": f"Bearer {cfg['api_key']}"}

    def get(path):
        req = urllib.request.Request(cfg["base_url"] + path, headers=headers)
        with (opener or opener_for(req.full_url))(req, timeout=15) as r:
            return json.loads(r.read().decode("utf-8"))

    try:
        if cfg["provider"] == "openrouter":
            get("/key")  # the model list is public there; this is what checks the key
        data = get("/models")
        data = (data.get("data") or []) if isinstance(data, dict) else []
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            return {"ok": False, "error": f"{name} rejected the API key (HTTP {e.code}). Check it and save again.",
                    "models": []}
        detail = error_detail(e.read().decode("utf-8", "replace"))
        return {"ok": False, "error": f"{name} HTTP {e.code}: {str(detail)[:300]}", "models": []}
    except (urllib.error.URLError, OSError, ValueError) as e:
        hint = " Is the local server running?" if cfg["provider"] == "custom" else ""
        return {"ok": False, "error": f"Can't reach {name}: {getattr(e, 'reason', e)}.{hint}", "models": []}
    models = sorted({str(m.get("id")) for m in data if isinstance(m, dict) and m.get("id")})[:500]
    out = {"ok": True, "models": models}
    vision = {str(m.get("id")) for m in data if isinstance(m, dict)
              and "image" in ((m.get("architecture") or {}).get("input_modalities") or [])}
    model = cfg["model"]
    if model and models and model not in models:
        out["warning"] = f"{name} does not list the model {model}. Check the spelling."
    elif model and vision and model not in vision:
        out["warning"] = f"{model} does not take pictures. Pick a vision model."
    return out


def list_models(cfg, opener=None):
    """Model ids the provider offers (GET {base_url}/models), for the model picker. [] on any failure."""
    return check(cfg, opener)["models"]
