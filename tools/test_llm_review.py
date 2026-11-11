#!/usr/bin/env python3
"""llm_review: key lookup, request shape, reply parsing (no network)."""
from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import llm_review  # noqa: E402

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
        p = mock.patch.object(llm_review, "LOCAL_CFG", self.cfg)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.tmp.cleanup)

    def test_env_wins_over_file(self):
        self.cfg.write_text(json.dumps({"api_key": "file-key", "model": "m/file"}))
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "env-key"}, clear=True):
            self.assertEqual(llm_review.load_config(), {"api_key": "env-key", "model": "m/file"})
            self.assertEqual(llm_review.status()["source"], "env")

    def test_file_and_missing(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(llm_review.status()["configured"])
            code, body = llm_review.review({"images": [IMG]})
            self.assertEqual(code, 400)
            self.cfg.write_text(json.dumps({"api_key": "file-key"}))
            st = llm_review.status()
            self.assertEqual((st["configured"], st["source"], st["model"]), (True, "file", llm_review.DEFAULT_MODEL))
            self.assertNotIn("api_key", st)


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
