"""Build the OrcaSlicer plugin: bundle app/index.html into one self-contained page and embed it.

    cd plugin && npm ci && python build.py      ->  dist/mesh_splitter_any.py

OrcaSlicer loads plugin pages with wxWebView::SetPage (WebView2 NavigateToString on Windows, ~2 MB cap),
from a file:// base and with no network promise, so the CDN importmap is replaced by an esbuild bundle of
the page's module script (three, three-mesh-bvh, fflate from node_modules, versions pinned in
package.json to match the importmap).
"""
import argparse
import json
import re
import subprocess
import sys
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
    entry.write_text(js, encoding="utf-8")
    esbuild = HERE / "node_modules" / ".bin" / ("esbuild.cmd" if sys.platform == "win32" else "esbuild")
    out = subprocess.run(
        [str(esbuild), str(entry), "--bundle", "--format=esm", "--target=es2020",
         "--legal-comments=none", "--log-level=warning"],
        cwd=HERE, check=True, capture_output=True, text=True, encoding="utf-8")
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
    src = (HERE / "plugin.py").read_text(encoding="utf-8")
    lit = "(\n" + "".join(f"    {line!r}\n" for line in page.splitlines(keepends=True)) + ")"
    for key, val in (("__VERSION__", a.version), ('"__PAGE__"', lit)):
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
