#!/usr/bin/env python3
"""Mesh Splitter AI part naming for the local server: settings on this machine + one request per click.

The provider logic is in llm_providers.py (shared with the OrcaSlicer plugin). Keys never go to the page.

Settings: server/llm.local.json (gitignored), written by the AI settings in the page.
Key overrides (win over the saved key for that provider):
  1. env OPENROUTER_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / MESH_SPLITTER_LLM_KEY (custom)
  2. the same names in .env in the repo root (gitignored); OPENROUTER_MODEL=... also works
  3. legacy server/openrouter.local.json {"api_key": "...", "model": "..."} for OpenRouter
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import llm_providers as P

HERE = Path(__file__).resolve().parent
SETTINGS = HERE / "llm.local.json"
LOCAL_CFG = HERE / "openrouter.local.json"  # legacy
DOTENV = HERE.parent / ".env"
DEFAULT_MODEL = P.PROVIDERS["openrouter"]["model"]
extract_json = P.extract_json
build_messages = P.build_messages
ENV_NAMES = [d["env"] for d in P.PROVIDERS.values()] + ["OPENROUTER_MODEL"]


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


def read_json(path: Path) -> dict:
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def load_store() -> dict:
    store = read_json(SETTINGS)
    legacy = read_json(LOCAL_CFG)
    if legacy.get("api_key") or legacy.get("model"):  # fold the old OpenRouter file in, without overriding
        cur = (store.setdefault("providers", {})).setdefault("openrouter", {})
        if legacy.get("api_key") and not cur.get("api_key"):
            cur["api_key"] = legacy["api_key"]
        if legacy.get("model") and not cur.get("model"):
            cur["model"] = legacy["model"]
    return store


def key_env() -> dict:
    """Key overrides: process env first, then .env. '_source' says where the active one came from."""
    dot = read_dotenv(DOTENV)
    out: dict = {}
    for name in ENV_NAMES:
        if os.environ.get(name):
            out[name] = os.environ[name]
        elif dot.get(name):
            out[name] = dot[name]
    return out


def active() -> dict:
    env = key_env()
    cfg = P.resolve(load_store(), env)
    if cfg["key_source"] == "env":  # say whether it was the real env or .env
        name = P.PROVIDERS[cfg["provider"]]["env"]
        cfg["key_source"] = "env" if os.environ.get(name) else ".env"
    return cfg


def load_config() -> dict:
    cfg = active()
    return {"api_key": cfg["api_key"], "model": cfg["model"]}


def status() -> dict:
    st = P.status(load_store(), key_env())
    cfg = active()
    st["source"] = cfg["key_source"]
    if cfg["key_source"] in ("env", ".env"):
        st["key_note"] = f"{P.PROVIDERS[cfg['provider']]['env']} from {cfg['key_source']}"
    return st


def save_settings(patch: dict) -> tuple[int, dict]:
    try:
        store = P.update(read_json(SETTINGS), patch)
    except ValueError as e:
        return 400, {"ok": False, "error": str(e)}
    SETTINGS.write_text(json.dumps(store, indent=2), encoding="utf-8")
    try:
        os.chmod(SETTINGS, 0o600)  # it may hold an API key
    except OSError:
        pass
    return 200, {"ok": True, **status()}


def models() -> tuple[int, dict]:
    return 200, {"ok": True, "models": P.list_models(active())}


def review(body: dict, opener=None) -> tuple[int, dict]:
    kw = {"opener": opener} if opener else {}
    return P.call(active(), body, **kw)
