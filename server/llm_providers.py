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
TIMEOUT = 300  # seconds; local models on a GPU can take a while

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
                   "output_config": {"effort": "low"}}
        if re.match(r"claude-(opus-5|sonnet-5-5|fable-5)", model):
            # On a safety decline, let the API re-run the request on a fallback model instead of failing.
            headers["anthropic-beta"] = "server-side-fallback-2026-07-01"
            payload["fallbacks"] = "default"
        return cfg["base_url"] + "/messages", headers, payload
    if cfg["api_key"]:
        headers["Authorization"] = f"Bearer {cfg['api_key']}"
    payload = {"messages": build_messages(body)}
    if model:
        payload["model"] = model  # a local server with one model loaded may not need it
    if cfg["provider"] in ("openrouter", "openai"):
        payload["response_format"] = {"type": "json_object"}  # local servers often reject json_object
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


def call(cfg, body, opener=None):
    """Send one naming request. Returns (http_status, {"ok", "result" | "error", ...}) for the page."""
    spec = PROVIDERS[cfg["provider"]]
    name = cfg["label"] if cfg["provider"] != "custom" else cfg["base_url"]
    if spec["needs_key"] and not cfg["api_key"]:
        return 400, {"ok": False, "error": f"No {cfg['label']} API key. Add one in AI settings."}
    if cfg["api"] == "openai" and cfg["provider"] != "custom" and not str(body.get("model") or cfg["model"]).strip():
        return 400, {"ok": False, "error": "Pick a model first."}
    url, headers, payload = build_request(cfg, body)
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    opener = opener or opener_for(url)
    try:
        with opener(req, timeout=TIMEOUT) as r:
            resp = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = error_detail(e.read().decode("utf-8", "replace"))
        return 502, {"ok": False, "error": f"{name} HTTP {e.code}: {str(detail)[:400]}"}
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        hint = " Is the local server running?" if cfg["provider"] == "custom" else ""
        return 502, {"ok": False, "error": f"{name} unreachable: {getattr(e, 'reason', e)}.{hint}"}
    except (json.JSONDecodeError, UnicodeDecodeError):
        return 502, {"ok": False, "error": f"{name} did not return JSON"}
    if isinstance(resp, dict) and resp.get("error"):
        err = resp["error"]
        return 502, {"ok": False, "error": str(err.get("message") if isinstance(err, dict) else err)[:400]}
    try:
        text, usage, model = read_reply(cfg, resp)
    except ValueError as e:
        return 502, {"ok": False, "error": f"{name}: {e}"}
    try:
        result = extract_json(text)
    except json.JSONDecodeError:
        return 502, {"ok": False, "error": "Model did not return JSON", "raw": text[:2000]}
    return 200, {"ok": True, "model": model or payload.get("model") or "local model", "usage": usage, "result": result}


def list_models(cfg, opener=None):
    """Model ids the provider offers (GET {base_url}/models), for the model picker. [] on any failure."""
    headers = {}
    if cfg["api"] == "anthropic":
        if not cfg["api_key"]:
            return []
        headers = {"x-api-key": cfg["api_key"], "anthropic-version": "2023-06-01"}
    elif cfg["api_key"]:
        headers = {"Authorization": f"Bearer {cfg['api_key']}"}
    elif PROVIDERS[cfg["provider"]]["needs_key"]:
        return []
    try:
        req = urllib.request.Request(cfg["base_url"] + "/models", headers=headers)
        with (opener or opener_for(req.full_url))(req, timeout=10) as r:
            data = json.loads(r.read().decode("utf-8")).get("data") or []
    except Exception:
        return []
    return sorted({str(m.get("id")) for m in data if isinstance(m, dict) and m.get("id")})[:500]
