#!/usr/bin/env python3
"""Mesh Splitter LLM review: send rendered part views + stats to a vision model on OpenRouter.

Key lookup (never sent to the browser, never committed):
  1. env OPENROUTER_API_KEY
  2. .env in the repo root (OPENROUTER_API_KEY=..., optional OPENROUTER_MODEL=...)   (gitignored)
  3. server/openrouter.local.json  {"api_key": "...", "model": "..."}   (gitignored)
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

LOCAL_CFG = Path(__file__).resolve().parent / "openrouter.local.json"
DOTENV = Path(__file__).resolve().parent.parent / ".env"
URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash"
MAX_IMAGES = 6

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


def read_dotenv(path: Path) -> dict:
    """KEY=value lines; ignores blanks, # comments, `export ` prefixes and surrounding quotes."""
    out: dict = {}
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except OSError:
        return out
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip().removeprefix("export ").strip()
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
            v = v[1:-1]
        out[k] = v
    return out


def load_config() -> dict:
    cfg: dict = {}
    if LOCAL_CFG.is_file():
        try:
            cfg = json.loads(LOCAL_CFG.read_text(encoding="utf-8")) or {}
        except (OSError, json.JSONDecodeError):
            cfg = {}
    env = read_dotenv(DOTENV)
    key = os.environ.get("OPENROUTER_API_KEY") or env.get("OPENROUTER_API_KEY") or cfg.get("api_key") or ""
    model = os.environ.get("OPENROUTER_MODEL") or env.get("OPENROUTER_MODEL") or cfg.get("model") or DEFAULT_MODEL
    return {"api_key": key.strip(), "model": model}


def status() -> dict:
    cfg = load_config()
    if os.environ.get("OPENROUTER_API_KEY"):
        src = "env"
    elif read_dotenv(DOTENV).get("OPENROUTER_API_KEY"):
        src = ".env"
    else:
        src = "file" if cfg["api_key"] else None
    return {"configured": bool(cfg["api_key"]), "source": src, "model": cfg["model"]}


def extract_json(text: str) -> dict:
    """Model replies are usually JSON, sometimes fenced or wrapped in prose."""
    text = text.strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if m:
        text = m.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        a, b = text.find("{"), text.rfind("}")
        if a >= 0 and b > a:
            return json.loads(text[a : b + 1])
        raise


def build_messages(body: dict) -> list[dict]:
    images = [i for i in body.get("images") or [] if isinstance(i, str) and i.startswith("data:image/")][:MAX_IMAGES]
    stats = body.get("stats") or {}
    content: list[dict] = [
        {"type": "text", "text": "Part stats:\n" + json.dumps(stats, separators=(",", ":"))},
    ]
    for cap, img in zip(body.get("captions") or [], images):
        content.append({"type": "text", "text": str(cap)[:200]})
        content.append({"type": "image_url", "image_url": {"url": img}})
    for img in images[len(body.get("captions") or []) :]:
        content.append({"type": "image_url", "image_url": {"url": img}})
    hint = str(body.get("hint") or "").strip()
    if hint:
        content.append({"type": "text", "text": "User note: " + hint[:500]})
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": content}]


def review(body: dict, opener=urllib.request.urlopen) -> tuple[int, dict]:
    cfg = load_config()
    if not cfg["api_key"]:
        return 400, {"ok": False, "error": "No OpenRouter key. Set OPENROUTER_API_KEY or create server/openrouter.local.json."}
    model = str(body.get("model") or cfg["model"]).strip()
    payload = {
        "model": model,
        "messages": build_messages(body),
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }
    req = urllib.request.Request(
        URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {cfg['api_key']}",
            "Content-Type": "application/json",
            "X-Title": "Mesh Splitter",
        },
        method="POST",
    )
    try:
        with opener(req, timeout=180) as r:
            resp = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        try:
            detail = json.loads(detail).get("error", {}).get("message") or detail
        except (json.JSONDecodeError, AttributeError):
            pass
        return 502, {"ok": False, "error": f"OpenRouter HTTP {e.code}: {str(detail)[:400]}"}
    except (urllib.error.URLError, TimeoutError) as e:
        return 502, {"ok": False, "error": f"OpenRouter unreachable: {e}"}
    if resp.get("error"):
        return 502, {"ok": False, "error": str(resp["error"].get("message") or resp["error"])[:400]}
    try:
        text = resp["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        return 502, {"ok": False, "error": "Unexpected OpenRouter response"}
    try:
        result = extract_json(text)
    except json.JSONDecodeError:
        return 502, {"ok": False, "error": "Model did not return JSON", "raw": text[:2000]}
    return 200, {"ok": True, "model": resp.get("model", model), "usage": resp.get("usage"), "result": result}
