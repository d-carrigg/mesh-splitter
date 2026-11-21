"""Build the OrcaSlicer plugin: bundle app/index.html into one self-contained page and embed it.

    cd plugin && npm ci && python build.py      ->  dist/mesh_splitter_any.py

OrcaSlicer loads plugin pages with wxWebView::SetPage (WebView2 NavigateToString on Windows, ~2 MB cap),
from a file:// base and with no network promise, so the CDN importmap is replaced by an esbuild bundle of
the page's module script (three, three-mesh-bvh, fflate from node_modules, versions pinned in
package.json to match the importmap).
"""
import argparse
import base64
import json
import os
import re
import subprocess
import sys
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
SEGMENT = HERE.parent / "app" / "index.html"
MAX_PAGE = 1_800_000  # bytes; stay clear of WebView2's 2 MB NavigateToString limit

IMPORTMAP_RE = re.compile(r'<script type="importmap">.*?</script>\s*', re.S)
MODULE_RE = re.compile(r'<script type="module">(.*?)</script>', re.S)


def check_versions(html):
    """The importmap pins CDN versions; package.json must pin the same ones."""
    pkg = json.loads((HERE / "package.json").read_text())["devDependencies"]
    for name in ("three", "three-mesh-bvh", "fflate"):
        m = re.search(rf"/npm/{re.escape(name)}@([\d.]+)/", html)
        if m and m.group(1) != pkg[name]:
            sys.exit(f"{name}: app/index.html uses {m.group(1)}, package.json pins {pkg[name]}")


def bundle(js):
    entry = HERE / "build" / "entry.js"
    entry.parent.mkdir(exist_ok=True)
    # the page imports ./core.js next to app/index.html; core.js imports fflate, resolved from plugin/node_modules
    core = (SEGMENT.parent / "core.js").as_posix()
    js = js.replace('from "./core.js"', f'from "{core}"')
    entry.write_text(js, encoding="utf-8")
    esbuild = HERE / "node_modules" / ".bin" / ("esbuild.cmd" if sys.platform == "win32" else "esbuild")
    out = subprocess.run(
        [str(esbuild), str(entry), "--bundle", "--minify", "--format=esm", "--target=es2020",
         "--legal-comments=none", "--log-level=warning"],
        cwd=HERE, check=True, capture_output=True, text=True, encoding="utf-8",
        env={**os.environ, "NODE_PATH": str(HERE / "node_modules")})
    if out.stderr.strip():
        print(out.stderr, file=sys.stderr)
    return out.stdout


def build_page():
    html = SEGMENT.read_text(encoding="utf-8")
    check_versions(html)
    m = MODULE_RE.search(html)
    if not m or not IMPORTMAP_RE.search(html):
        sys.exit("app/index.html: importmap or module script not found")
    js = bundle(m.group(1)).replace("</script", "<\\/script")
    page = html[:m.start()] + '<script type="module">' + js + "</script>" + html[m.end():]
    page = IMPORTMAP_RE.sub("", page)
    if "cdn.jsdelivr.net" in page:
        sys.exit("bundled page still references the CDN")
    return page


LLM_IMPORT_RE = re.compile(r"^from llm_providers import (.+?)  # noqa: E402  __LLM_PROVIDERS__$", re.M)


def inline_llm(src):
    """Replace plugin.py's `from llm_providers import ...` with that module's code (one file to install)."""
    m = LLM_IMPORT_RE.search(src)
    if not m:
        sys.exit("plugin.py: llm_providers import marker not found")
    mod = (HERE.parent / "server" / "llm_providers.py").read_text(encoding="utf-8")
    doc = re.match(r'^"""(.*?)"""\n', mod, re.S)
    mod = mod[doc.end():]  # the module docstring becomes comments: it says when the code connects and to where
    notes = "\n".join(("# " + line).rstrip() for line in doc.group(1).strip().splitlines())
    aliases = "\n".join(f"{a.strip()} = {n.strip()}" for n, a in
                         (x.split(" as ") for x in m.group(1).split(",")) if n.strip() != a.strip())
    block = f"# ---- inlined from server/llm_providers.py (AI part naming) ----\n{notes}\n{mod.strip()}\n{aliases}\n# ---- end llm_providers ----"
    return src[:m.start()] + block + src[m.end():]


def project_version():
    """The single source of the version: [project].version in the repo's pyproject.toml."""
    m = re.search(r'^version\s*=\s*"([^"]+)"', (HERE.parent / "pyproject.toml").read_text(encoding="utf-8"), re.M)
    if not m:
        sys.exit("pyproject.toml: no [project] version")
    return m.group(1)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--version", default=project_version(), help="defaults to [project].version in pyproject.toml")
    ap.add_argument("--out", default=str(HERE / "dist" / "mesh_splitter_any.py"))
    ap.add_argument("--page-out", help="also write the bundled page here (for testing in a browser)")
    a = ap.parse_args()
    page = build_page()
    size = len(page.encode("utf-8"))
    if size > MAX_PAGE:
        sys.exit(f"bundled page is {size:,} bytes; OrcaSlicer's webview limit is about 2 MB")
    src = inline_llm((HERE / "plugin.py").read_text(encoding="utf-8"))
    z = base64.b64encode(zlib.compress(page.encode("utf-8"), 9)).decode("ascii")
    for key, val in (("__VERSION__", a.version), ("__PAGE_Z__", z)):
        if src.count(key) != 1:
            sys.exit(f"plugin.py: expected one {key}")
        src = src.replace(key, val)
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(src, encoding="utf-8", newline="\n")
    if a.page_out:
        Path(a.page_out).write_text(page, encoding="utf-8")
    print(f"{out}  (page {size:,} bytes, plugin {out.stat().st_size:,} bytes, v{a.version})")


if __name__ == "__main__":
    main()
