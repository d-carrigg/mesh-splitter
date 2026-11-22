"""Build the OrcaSlicer plugin: bundle app/ (index.html, styles.css, main.js) into one self-contained page and package it in a wheel.

    cd plugin && npm ci && python build.py              ->  dist/mesh_splitter_copy_any.whl  (unofficial copy)
    cd plugin && npm ci && python build.py --official   ->  dist/mesh_splitter_any.whl       (official name)

Builds are named as an unofficial copy unless --official is given or MESH_SPLITTER_OFFICIAL_BUILD=true is set (the
official repo sets it as an Actions variable). So a fork or clone that builds and publishes gets its own plugin
name and key and its page does not say "Official build"; only the official repo's CI keeps "Mesh Splitter" and
mesh_splitter_any, so existing installs keep updating.

The wheel holds the package mesh_splitter_any/ (__init__.py = plugin.py with llm_providers inlined, handoff.py and
project3mf.py for Send to Orca, page.html = the bundled page) and its .dist-info. Everything is plain text, so a reviewer can read it as shipped. OrcaSlicer
installs .whl plugins (Plugins > Install local plugin) and imports the package named in top_level.txt.
The file name has no version so the local plugin key, and with it the plugin's saved settings, stay the same
across updates.

OrcaSlicer loads plugin pages with wxWebView::SetPage (WebView2 NavigateToString on Windows, ~2 MB cap),
from a file:// base and with no network promise, so the CDN importmap is replaced by an esbuild bundle of
app/main.js (three, three-mesh-bvh, fflate from node_modules, versions pinned in package.json to match the
importmap), and app/styles.css is inlined, since the page can't load files next to it.
"""
import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parent / "app"
SEGMENT = APP / "index.html"
MAX_PAGE = 1_800_000  # bytes; stay clear of WebView2's 2 MB NavigateToString limit

IMPORTMAP_RE = re.compile(r'<script type="importmap">.*?</script>\s*', re.S)
MODULE_RE = re.compile(r'<script type="module" src="\./main\.js"></script>')
STYLE_RE = re.compile(r'<link rel="stylesheet" href="\./styles\.css">')


def check_versions(html):
    """The importmap pins CDN versions; package.json must pin the same ones."""
    pkg = json.loads((HERE / "package.json").read_text())["devDependencies"]
    for name in ("three", "three-mesh-bvh", "three-bvh-csg", "fflate"):
        m = re.search(rf"/npm/{re.escape(name)}@([\d.]+)/", html)
        if m and m.group(1) != pkg[name]:
            sys.exit(f"{name}: app/index.html uses {m.group(1)}, package.json pins {pkg[name]}")


def bundle():
    # main.js imports ./core.js etc. next to it; bare imports (three, fflate, ...) resolve from plugin/node_modules
    esbuild = HERE / "node_modules" / ".bin" / ("esbuild.cmd" if sys.platform == "win32" else "esbuild")
    out = subprocess.run(
        [str(esbuild), str(APP / "main.js"), "--bundle", "--minify", "--format=esm", "--target=es2020",
         "--legal-comments=none", "--log-level=warning"],
        cwd=HERE, check=True, capture_output=True, text=True, encoding="utf-8",
        env={**os.environ, "NODE_PATH": str(HERE / "node_modules")})
    if out.stderr.strip():
        print(out.stderr, file=sys.stderr)
    return out.stdout


def build_page():
    html = SEGMENT.read_text(encoding="utf-8")
    check_versions(html)
    m, st = MODULE_RE.search(html), STYLE_RE.search(html)
    if not m or not st or not IMPORTMAP_RE.search(html):
        sys.exit("app/index.html: importmap, main.js script or styles.css link not found")
    js = bundle().replace("</script", "<\\/script")
    css = (APP / "styles.css").read_text(encoding="utf-8")
    page = html[:m.start()] + '<script type="module">' + js + "</script>" + html[m.end():]
    page = STYLE_RE.sub(lambda _: "<style>\n" + css + "</style>", page)
    page = IMPORTMAP_RE.sub("", page)
    if re.search(r"cdn\.jsdelivr\.net", page):  # build check, not URL sanitizing
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


OFFICIAL_ENV = "MESH_SPLITTER_OFFICIAL_BUILD"
OFFICIAL_NAME, OFFICIAL_PACKAGE = "Mesh Splitter", "mesh_splitter_any"
COPY_NAME, COPY_PACKAGE = "Mesh Splitter (unofficial copy)", "mesh_splitter_copy_any"  # OrcaCloud wants the _any suffix
OFFICIAL_LINE_RE = re.compile(r'<p id="official"[^>]*>.*?</p>', re.S)
COPY_LINE = ('<p id="official" class="sub">Unofficial copy. The official Mesh Splitter is by '
             '<a href="https://github.com/d-carrigg/mesh-splitter#official-releases" target="_blank" rel="noopener">@dcarrigg</a>.</p>')
SUBMODULES = ["handoff", "project3mf"]  # plugin/<name>.py, shipped next to __init__.py
SUBMODULE_RE = re.compile(rf"^import ({'|'.join(SUBMODULES)})  # noqa: E402$", re.M)
HEADER_RE = re.compile(r"\A# /// script\n(.*?)^# ///\n", re.S | re.M)


def header_field(header, key):
    m = re.search(rf'^# {key} = "(.*)"$', header, re.M)
    if not m:
        sys.exit(f"plugin.py: no {key} in the script header")
    return m.group(1)


def as_copy(src, page):
    """Rename the plugin to the unofficial copy name and replace the page's "Official build" line."""
    name_line = f'# name = "{OFFICIAL_NAME}"'
    if src.count(name_line) != 1:
        sys.exit(f"plugin.py: expected one `{name_line}` in the script header")
    if len(OFFICIAL_LINE_RE.findall(page)) != 1:
        sys.exit('app/index.html: expected one <p id="official"> line')
    return src.replace(name_line, f'# name = "{COPY_NAME}"'), OFFICIAL_LINE_RE.sub(COPY_LINE, page)


def write_wheel(out, src, page, version, package):
    """A pure-Python wheel: OrcaSlicer reads Name/Version/Summary/Author/Requires-Dist from METADATA."""
    m = HEADER_RE.match(src)
    if not m:
        sys.exit("plugin.py: script header not found")
    header, code = m.group(1), src[m.end():]
    deps = json.loads(re.search(r"^# dependencies = (\[.*\])$", header, re.M).group(1))
    info = f"{package}-{version}.dist-info/"
    if len(SUBMODULE_RE.findall(code)) != len(SUBMODULES):
        sys.exit(f"plugin.py: expected `import <name>  # noqa: E402` for each of {SUBMODULES}")
    code = SUBMODULE_RE.sub(r"from . import \1  # noqa: E402", code)  # in the package they're siblings
    files = {
        f"{package}/__init__.py": code,
        **{f"{package}/{m}.py": (HERE / f"{m}.py").read_text(encoding="utf-8") for m in SUBMODULES},
        f"{package}/page.html": page,
        info + "METADATA": "Metadata-Version: 2.1\n"
                           f"Name: {header_field(header, 'name')}\nVersion: {version}\n"
                           f"Summary: {header_field(header, 'description')}\nAuthor: {header_field(header, 'author')}\n"
                           "License: MIT\nLicense-File: LICENSE\nRequires-Python: >=3.12\n" + "".join(f"Requires-Dist: {d}\n" for d in deps),
        info + "WHEEL": "Wheel-Version: 1.0\nGenerator: mesh-splitter plugin/build.py\nRoot-Is-Purelib: true\n"
                        "Tag: py3-none-any\n",
        info + "top_level.txt": package + "\n",
        info + "LICENSE": (HERE.parent / "LICENSE").read_text(encoding="utf-8"),
    }
    record = ""
    for name, text in files.items():
        data = text.encode("utf-8")
        digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode("ascii")
        record += f"{name},sha256={digest},{len(data)}\n"
    files[info + "RECORD"] = record + f"{info}RECORD,,\n"
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, text in files.items():
            z.writestr(zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0)), text.encode("utf-8"), zipfile.ZIP_DEFLATED)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--version", default=project_version(), help="defaults to [project].version in pyproject.toml")
    ap.add_argument("--official", action="store_true", default=os.environ.get(OFFICIAL_ENV, "").lower() == "true",
                    help=f"official name and key (also when {OFFICIAL_ENV}=true); otherwise an unofficial copy")
    ap.add_argument("--out", help="defaults to dist/<package>.whl")
    ap.add_argument("--page-out", help="also write the bundled page here (for testing in a browser)")
    a = ap.parse_args()
    package = OFFICIAL_PACKAGE if a.official else COPY_PACKAGE
    page = build_page()
    size = len(page.encode("utf-8"))
    if size > MAX_PAGE:
        sys.exit(f"bundled page is {size:,} bytes; OrcaSlicer's webview limit is about 2 MB")
    src = inline_llm((HERE / "plugin.py").read_text(encoding="utf-8"))
    if src.count("__VERSION__") != 1:
        sys.exit("plugin.py: expected one __VERSION__")
    src = src.replace("__VERSION__", a.version)
    if not a.official:
        src, page = as_copy(src, page)
    out = Path(a.out or HERE / "dist" / f"{package}.whl")
    write_wheel(out, src, page, a.version, package)
    kind = "official" if a.official else "unofficial copy"
    if a.page_out:
        page_out = Path(a.page_out)
        page_out.parent.mkdir(parents=True, exist_ok=True)
        page_out.write_text(page, encoding="utf-8")
    print(f"{out}  (page {size:,} bytes, plugin {out.stat().st_size:,} bytes, v{a.version}, {kind})")


if __name__ == "__main__":
    main()
