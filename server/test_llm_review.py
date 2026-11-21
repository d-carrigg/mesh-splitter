#!/usr/bin/env python3
"""AI part naming: settings and key lookup, request shape per provider, reply parsing, and a real round trip
to a local OpenAI-compatible mock server (like LM Studio) on 127.0.0.1."""
from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import urllib.error
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import llm_providers as P  # noqa: E402
import llm_review  # noqa: E402
import mock_llm_server  # noqa: E402

IMG = "data:image/jpeg;base64,AAAA"


class FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = Path(self.tmp.name) / "openrouter.local.json"
        self.dotenv = Path(self.tmp.name) / ".env"
        self.settings = Path(self.tmp.name) / "llm.local.json"
        for name, val in (("LOCAL_CFG", self.cfg), ("DOTENV", self.dotenv), ("SETTINGS", self.settings)):
            p = mock.patch.object(llm_review, name, val)
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.tmp.cleanup)

    def test_env_wins_over_file(self):
        self.cfg.write_text(json.dumps({"api_key": "file-key", "model": "m/file"}))
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "env-key"}, clear=True):
            self.assertEqual(llm_review.load_config(), {"api_key": "env-key", "model": "m/file"})
            self.assertEqual(llm_review.status()["source"], "env")

    def test_dotenv(self):
        self.dotenv.write_text('# comment\nexport OPENROUTER_API_KEY="dot-key"\nOPENROUTER_MODEL=m/dot\n')
        self.cfg.write_text(json.dumps({"api_key": "file-key"}))
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(llm_review.load_config(), {"api_key": "dot-key", "model": "m/dot"})
            self.assertEqual(llm_review.status()["source"], ".env")

    def test_file_and_missing(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(llm_review.status()["configured"])
            code, body = llm_review.review({"images": [IMG]})
            self.assertEqual(code, 400)
            self.cfg.write_text(json.dumps({"api_key": "file-key"}))
            st = llm_review.status()
            self.assertEqual((st["configured"], st["source"], st["model"]), (True, "saved", llm_review.DEFAULT_MODEL))
            self.assertNotIn("api_key", st)

    def test_settings_saved_and_key_never_returned(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            code, st = llm_review.save_settings({"provider": "anthropic", "api_key": "sk-ant-secret", "model": "claude-opus-5-5"})
            self.assertEqual(code, 200)
            self.assertEqual((st["provider"], st["configured"], st["has_key"], st["source"]), ("anthropic", True, True, "saved"))
            self.assertNotIn("sk-ant-secret", json.dumps(st))
            # an empty key keeps the saved one; switching provider keeps each provider's own key
            llm_review.save_settings({"provider": "anthropic", "api_key": "", "model": "claude-haiku-5-5"})
            self.assertEqual(llm_review.active()["api_key"], "sk-ant-secret")
            st = llm_review.save_settings({"provider": "custom", "base_url": "http://localhost:1234/v1/chat/completions/"})[1]
            self.assertEqual((st["configured"], st["base_url"], st["has_key"]), (True, "http://localhost:1234/v1", False))
            st = llm_review.save_settings({"provider": "anthropic"})[1]
            self.assertEqual((st["model"], st["has_key"]), ("claude-haiku-5-5", True))
            st = llm_review.save_settings({"provider": "anthropic", "clear_key": True})[1]
            self.assertFalse(st["configured"])
            self.assertEqual(llm_review.save_settings({"provider": "custom", "base_url": "file:///etc"})[0], 400)
            self.assertEqual(llm_review.save_settings({"provider": "nope"})[0], 400)

    def test_env_key_picks_provider_when_nothing_saved(self):
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "a"}, clear=True):
            self.assertEqual(llm_review.status()["provider"], "anthropic")


def cfg(provider, key="k", base_url=None, model=None):
    c = P.resolve({"provider": provider, "providers": {provider: {"api_key": key, "base_url": base_url or "", "model": model or ""}}})
    return c


class ProviderTests(unittest.TestCase):
    def test_openai_and_openrouter_shape(self):
        for pid, host in (("openai", "https://api.openai.com/v1"), ("openrouter", "https://openrouter.ai/api/v1")):
            url, h, body = P.build_request(cfg(pid), {"images": [IMG], "captions": ["front"]})
            self.assertEqual(url, host + "/chat/completions")
            self.assertEqual(h["Authorization"], "Bearer k")
            self.assertEqual(body["response_format"], {"type": "json_object"})
            self.assertEqual(body["model"], P.PROVIDERS[pid]["model"])

    def test_anthropic_shape(self):
        url, h, body = P.build_request(cfg("anthropic"), {"images": [IMG], "captions": ["front"], "hint": "a cat"})
        self.assertEqual(url, "https://api.anthropic.com/v1/messages")
        self.assertEqual((h["x-api-key"], h["anthropic-version"]), ("k", "2023-06-01"))
        self.assertNotIn("Authorization", h)
        self.assertEqual(body["system"], P.NAMING_PROMPT)
        img = [c for c in body["messages"][0]["content"] if c["type"] == "image"][0]
        self.assertEqual(img["source"], {"type": "base64", "media_type": "image/jpeg", "data": "AAAA"})
        self.assertNotIn("temperature", body)

        def opener(req, timeout):
            reply = {"model": "claude-opus-5-5", "stop_reason": "end_turn", "usage": {"input_tokens": 5, "output_tokens": 7},
                     "content": [{"type": "thinking", "thinking": ""}, {"type": "text", "text": '{"parts": []}'}]}
            return FakeResp(json.dumps(reply).encode())
        code, out = P.call(cfg("anthropic"), {"images": [IMG]}, opener=opener)
        self.assertEqual((code, out["result"], out["usage"]["completion_tokens"]), (200, {"parts": []}, 7))

    def test_custom_needs_no_key_and_no_json_mode(self):
        c = cfg("custom", key="", base_url="http://127.0.0.1:1234/v1")
        url, h, body = P.build_request(c, {"images": [IMG]})
        self.assertEqual(url, "http://127.0.0.1:1234/v1/chat/completions")
        self.assertNotIn("Authorization", h)
        self.assertNotIn("response_format", body)
        self.assertNotIn("model", body)  # blank model: the server's loaded model

    def test_missing_key_is_not_sent(self):
        def opener(req, timeout):
            raise AssertionError("must not send")
        self.assertEqual(P.call(cfg("openai", key=""), {}, opener=opener)[0], 400)

    def test_extract_json_with_think_block(self):
        self.assertEqual(P.extract_json('<think>{"no": 1}</think>\n{"a": 2}'), {"a": 2})


class LocalServerTests(unittest.TestCase):
    """Real HTTP round trip to a mock OpenAI-compatible server, as LM Studio or Ollama would serve it."""

    def test_round_trip(self):
        with mock_llm_server.running() as srv:
            c = cfg("custom", key="", base_url=srv.base_url)
            self.assertEqual(P.list_models(c), ["mock-vision-1"])
            code, out = P.call(c, {"images": [IMG], "captions": ["front"], "stats": {"parts": [{"id": 1}]}})
            self.assertEqual(code, 200, out)
            self.assertEqual(out["result"]["parts"][0]["name"], "mock part 1")
            req = srv.requests[-1]
            self.assertEqual(req["path"], "/v1/chat/completions")
            self.assertIsNone(req["auth"])
            self.assertEqual(req["images"], 1)

    def test_streamed_with_progress(self):
        with mock_llm_server.running(think=0.3) as srv:
            c = cfg("custom", key="", base_url=srv.base_url)
            seen = []
            code, out = P.call(c, {"images": [IMG], "stats": {"parts": [{"id": 1}, {"id": 2}]}},
                               progress=lambda stage, info: seen.append(stage))
            self.assertEqual(code, 200, out)
            self.assertTrue(srv.requests[-1]["stream"])
            self.assertEqual([p["name"] for p in out["result"]["parts"]], ["mock part 1", "mock part 2"])
            self.assertEqual(out["usage"]["completion_tokens"], 20)
            stages = list(dict.fromkeys(seen))
            self.assertEqual(stages, ["sending", "waiting", "thinking", "writing"])

    def test_stall_hits_total_limit(self):
        """A server that keeps the connection alive but never answers (keep-alive comments only) still ends."""
        with mock.patch.dict(P.LIMITS["local"], {"total": 1}), mock_llm_server.running(stall=True) as srv:
            code, out = P.call(cfg("custom", key="", base_url=srv.base_url), {"images": [IMG]})
        self.assertEqual(code, 504)
        self.assertIn("still answering", out["error"])

    def test_no_bytes_hits_first_byte_limit(self):
        with mock.patch.dict(P.LIMITS["local"], {"first_byte": 0.5}):
            with mock_llm_server.running(delay=3) as srv:
                code, out = P.call(cfg("custom", key="", base_url=srv.base_url), {"images": [IMG]})
        self.assertEqual(code, 504)
        self.assertIn("No answer from", out["error"])

    def test_cancel_aborts_blocked_read(self):
        import threading
        with mock_llm_server.running(stall=True) as srv:
            box, stop = {}, threading.Event()
            th = threading.Thread(target=lambda: box.setdefault("out", P.call(
                cfg("custom", key="", base_url=srv.base_url), {"images": [IMG]}, cancel=stop.is_set,
                on_response=lambda r: box.setdefault("r", r))))
            th.start()
            for _ in range(50):
                if "r" in box:
                    break
                threading.Event().wait(0.05)
            stop.set()
            P.abort(box["r"])
            th.join(5)
        self.assertFalse(th.is_alive())
        self.assertEqual(box["out"][0], 499)
        self.assertTrue(box["out"][1]["cancelled"])

    def test_check(self):
        with mock_llm_server.running(models=("a-vision",)) as srv:
            ok = P.check(cfg("custom", key="", base_url=srv.base_url) | {"model": "a-vision"})
            self.assertEqual((ok["ok"], ok["models"], ok.get("warning")), (True, ["a-vision"], None))
            typo = P.check(cfg("custom", key="", base_url=srv.base_url) | {"model": "a-visoin"})
            self.assertIn("does not list", typo["warning"])
        down = P.check(cfg("custom", key="", base_url="http://127.0.0.1:9/v1"))
        self.assertFalse(down["ok"])
        self.assertIn("local server running", down["error"])
        self.assertIn("API key", P.check(cfg("openai", key=""))["error"])

    def test_check_rejected_key(self):
        def opener(req, timeout):
            raise urllib.error.HTTPError(req.full_url, 401, "no", {}, io.BytesIO(b"{}"))
        out = P.check(cfg("openrouter"), opener=opener)
        self.assertIn("rejected the API key", out["error"])

    def test_server_down(self):
        code, out = P.call(cfg("custom", key="", base_url="http://127.0.0.1:9/v1"), {"images": [IMG]})
        self.assertEqual(code, 502)
        self.assertIn("local server running", out["error"])


class ReviewTests(unittest.TestCase):
    def test_extract_json(self):
        self.assertEqual(llm_review.extract_json('```json\n{"a": 1}\n```'), {"a": 1})
        self.assertEqual(llm_review.extract_json('Sure! {"a": {"b": 2}} done'), {"a": {"b": 2}})

    def test_request_and_reply(self):
        seen = {}

        def opener(req, timeout):
            seen["auth"] = req.get_header("Authorization")
            seen["body"] = json.loads(req.data)
            reply = {"model": "m/x", "choices": [{"message": {"content": '{"parts": [{"id": 1, "name": "boot"}], "issues": []}'}}]}
            return FakeResp(json.dumps(reply).encode())

        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "k"}, clear=True):
            code, out = llm_review.review(
                {"model": "m/x", "images": [IMG, "http://evil/x.png"], "captions": ["cap"], "stats": {"parts": []}}, opener=opener
            )
        self.assertEqual(code, 200)
        self.assertEqual(out["result"]["parts"][0]["name"], "boot")
        self.assertEqual(seen["auth"], "Bearer k")
        self.assertEqual(seen["body"]["model"], "m/x")
        user = seen["body"]["messages"][1]["content"]
        urls = [c["image_url"]["url"] for c in user if c["type"] == "image_url"]
        self.assertEqual(urls, [IMG])  # non-data URLs are dropped

    def test_non_json_reply(self):
        def opener(req, timeout):
            return FakeResp(json.dumps({"choices": [{"message": {"content": "I cannot see images"}}]}).encode())

        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "k"}, clear=True):
            code, out = llm_review.review({"images": [IMG]}, opener=opener)
        self.assertEqual(code, 502)
        self.assertIn("raw", out)


if __name__ == "__main__":
    unittest.main()
