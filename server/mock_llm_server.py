#!/usr/bin/env python3
"""A tiny OpenAI-compatible server for testing AI part naming without a real model (like LM Studio, no key).

    python server/mock_llm_server.py [--port 1234]     then use Custom, base URL http://127.0.0.1:1234/v1

It answers GET /v1/models and POST /v1/chat/completions, naming every part id it finds in the stats
"mock part N". It records each request (path, auth header, image count) in .requests for tests.
"""
import argparse
import contextlib
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, data):
        raw = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path.rstrip("/") == "/v1/models":
            return self._json(200, {"object": "list", "data": [{"id": "mock-vision-1", "object": "model"}]})
        self._json(404, {"error": {"message": "not found"}})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if self.path != "/v1/chat/completions":
            return self._json(404, {"error": {"message": "not found"}})
        if "response_format" in body and body["response_format"].get("type") == "json_object":  # like LM Studio
            return self._json(400, {"error": "'response_format.type' must be 'json_schema' or 'text'"})
        user = body["messages"][-1]["content"]
        stats = next((c["text"] for c in user if c.get("type") == "text" and c["text"].startswith("Part stats:")), "")
        ids = sorted({int(i) for i in re.findall(r'"id":(\d+)', stats)} - {0})
        self.server.requests.append({"path": self.path, "auth": self.headers.get("Authorization"),
                                     "images": sum(c.get("type") == "image_url" for c in user), "model": body.get("model")})
        reply = {"object": "model review", "parts": [{"id": i, "name": f"mock part {i}", "confidence": 0.9} for i in ids],
                 "issues": [], "summary": "Mock reply."}
        self._json(200, {"model": body.get("model") or "mock-vision-1", "usage": {"prompt_tokens": 10, "completion_tokens": 20},
                         "choices": [{"message": {"role": "assistant", "content": "<think>ok</think>\n" + json.dumps(reply)}}]})


@contextlib.contextmanager
def running(port=0):
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    srv.requests = []
    srv.base_url = f"http://127.0.0.1:{srv.server_address[1]}/v1"
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    try:
        yield srv
    finally:
        srv.shutdown()
        srv.server_close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=1234)
    a = ap.parse_args()
    with running(a.port) as s:
        print(f"Mock LLM at {s.base_url}  (Ctrl+C to stop)", flush=True)
        try:
            threading.Event().wait()
        except KeyboardInterrupt:
            pass
