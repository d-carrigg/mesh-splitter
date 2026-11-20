#!/usr/bin/env python3
"""Serve Mesh Splitter locally and open it in the browser.

uv run mesh-splitter [--port 8766] [--no-browser]
uv run mesh-splitter split MESH [options]     (command line; needs Node.js, see --help)

Static files from the repo root plus the AI part-naming endpoints (/api/llm/status, /api/llm/name-parts),
which keep the OpenRouter key on this machine.
"""
from __future__ import annotations

import argparse
import json
import shutil
import socket
import subprocess
import sys
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import llm_review  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PAGE = "/app/"
PORT = 8766


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _json(self, code: int, data: dict) -> None:
        raw = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path in ("/", "/index.html"):
            self.send_response(302)
            self.send_header("Location", PAGE)
            self.end_headers()
            return
        if path == "/api/llm/status":
            self._json(200, llm_review.status())
            return
        super().do_GET()

    def do_POST(self) -> None:
        if urlsplit(self.path).path != "/api/llm/name-parts":
            self._json(404, {"ok": False, "error": "not found"})
            return
        # JSON content type forces a CORS preflight (unhandled here), so other sites can't spend the key.
        if not (self.headers.get("Content-Type") or "").startswith("application/json"):
            self._json(415, {"ok": False, "error": "application/json required"})
            return
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode("utf-8") or "{}")
            if not isinstance(body, dict):
                raise ValueError
        except ValueError:
            self._json(400, {"ok": False, "error": "bad json"})
            return
        self._json(*llm_review.review(body))


def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


def split(argv: list[str]) -> int:
    """Run the command-line splitter (cli/split.mjs) with Node, installing its two npm packages on first use."""
    node, npm = shutil.which("node"), shutil.which("npm")
    if not node:
        print("mesh-splitter split needs Node.js 18 or newer: https://nodejs.org", file=sys.stderr)
        return 1
    if not (ROOT / "node_modules" / "fflate").is_dir() or not (ROOT / "node_modules" / "@xmldom").is_dir():
        if not npm:
            print("npm not found; run `npm ci` in the repo folder first.", file=sys.stderr)
            return 1
        print("First run: installing command-line packages (npm ci)...", file=sys.stderr, flush=True)
        r = subprocess.run([npm, "ci", "--omit=dev", "--no-audit", "--no-fund"], cwd=ROOT)
        if r.returncode:
            return r.returncode
    return subprocess.run([node, str(ROOT / "cli" / "split.mjs"), *argv]).returncode


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["split"]:
        return split(argv[1:])
    p = argparse.ArgumentParser(description="Serve Mesh Splitter locally.",
                                epilog="Split from the command line: mesh-splitter split --help")
    p.add_argument("--port", type=int, default=PORT)
    p.add_argument("--no-browser", action="store_true", help="Start the server only.")
    args = p.parse_args(argv)
    url = f"http://127.0.0.1:{args.port}{PAGE}"
    if port_in_use(args.port):
        print(f"Already running. Opening {url}", flush=True)
        if not args.no_browser:
            webbrowser.open(url)
        return 0
    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Mesh Splitter at {url}\nCtrl+C to stop.", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
