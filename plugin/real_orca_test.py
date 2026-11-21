#!/usr/bin/env python3
"""Install the built plugin in a real OrcaSlicer, start it, and check the plugin from the inside.

    python real_orca_test.py ORCA_APPRUN PLUGIN.py MESH.stl SPLIT.3mf [--out DIR] [--timeout S]

Needs an X display (CI runs it under xvfb-run). Uses a fresh OrcaSlicer data folder, installs
PLUGIN.py the way Plugins > Install local plugin does (orca_plugins/<file>/<file> + .install_state.json),
with the permissions it declares at load already granted (a modal prompt would block a headless run), plus the CI-only real_orca_probe.py. OrcaSlicer opens MESH.stl and SPLIT.3mf from its
command line; the probe drives the plugin's Bridge with the real `orca` bindings and reports back.

Fails unless OrcaSlicer logs a successful load of the plugin, the probe gets the right mesh back from
the plugin, OrcaSlicer imported SPLIT.3mf as one object with one part per split part, and AI part naming
reached a local mock OpenAI-compatible server and got names back.
Logs, the probe's report and a screenshot go to --out.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "server"))
import mock_llm_server  # noqa: E402
PLUGIN_KEY = "mesh_splitter_any"


def install(plugins_dir, src, name, permissions):
    """Same layout and sidecar OrcaSlicer 2.5.1 writes (PluginLoader.cpp install_plugin_from_file)."""
    d = plugins_dir / src.name
    d.mkdir(parents=True)
    shutil.copy(src, d / src.name)
    perms = {"fs_read": [], "fs_readwrite": [], "network_http": [], "network_socket": [], "process": [],
             "threading": False, "events": [], "full_access": False}
    perms.update(permissions)
    (d / ".install_state.json").write_text(json.dumps({
        "installed_from": "local", "installed_version": "", "plugin_name": name, "enabled": True,
        "permissions": perms, "capabilities": []}, indent=2))


def split_parts(path):
    """Part names Mesh Splitter wrote into the 3MF's model_settings.config."""
    cfg = ET.fromstring(zipfile.ZipFile(path).read("Metadata/model_settings.config"))
    return [m.get("value") for p in cfg.iter("part") for m in p.findall("metadata") if m.get("key") == "name"]


def screenshot(path):
    if shutil.which("import"):
        subprocess.run(["import", "-window", "root", str(path)], capture_output=True, timeout=30)


def window_names():
    """Titles of the top-level X windows, e.g. a modal prompt that blocks startup."""
    if not shutil.which("xwininfo"):
        return []
    out = subprocess.run(["xwininfo", "-root", "-tree"], capture_output=True, text=True, timeout=30).stdout
    return sorted({line.split('"')[1] for line in out.splitlines() if line.count('"') >= 2} - {""})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("orca")
    ap.add_argument("plugin", type=Path)
    ap.add_argument("mesh", type=Path)
    ap.add_argument("split_3mf", type=Path)
    ap.add_argument("--out", type=Path, default=Path("build/real-orca"))
    ap.add_argument("--timeout", type=int, default=240)
    a = ap.parse_args()

    a.out.mkdir(parents=True, exist_ok=True)
    data = Path(tempfile.mkdtemp(prefix="orca-data-"))
    plugins = data / "orca_plugins"
    downloads = Path.home() / "Downloads"
    downloads.mkdir(exist_ok=True)
    # What a user grants by clicking Yes on the plugin's one install prompt (register_capabilities).
    install(plugins, a.plugin.resolve(), "Mesh Splitter", {
        "fs_readwrite": [str(downloads / "*")],
        "network_http": ["https://openrouter.ai", "https://api.openai.com", "https://api.anthropic.com"],
        "threading": True})
    install(plugins, HERE / "real_orca_probe.py", "Mesh Splitter CI probe", {"full_access": True})

    report = a.out / "probe.json"
    report.unlink(missing_ok=True)
    llm_ctx = mock_llm_server.running(think=0.5)  # keep a reference: the server stops when this is collected
    llm = llm_ctx.__enter__()
    stall_ctx = mock_llm_server.running(stall=True)  # never answers: for Cancel
    stall = stall_ctx.__enter__()
    env = dict(os.environ, MESH_SPLITTER_PROBE_OUT=str(report.resolve()), LIBGL_ALWAYS_SOFTWARE="1",
               LANG=os.environ.get("LANG", "C.UTF-8"), MESH_SPLITTER_MOCK_LLM=llm.base_url,
               MESH_SPLITTER_MOCK_LLM_STALL=stall.base_url)
    # Without SSL_CERT_FILE, OrcaSlicer on Linux asks "use system SSL certificate ...?" in a modal at startup.
    env.setdefault("SSL_CERT_FILE", "/etc/ssl/certs/ca-certificates.crt")
    with open(a.out / "orca-stdout.log", "w") as log:
        proc = subprocess.Popen([a.orca, "--datadir", str(data), str(a.mesh.resolve()), str(a.split_3mf.resolve())],
                                stdout=log, stderr=subprocess.STDOUT, env=env, start_new_session=True)
        t0 = time.time()
        while time.time() - t0 < a.timeout and not report.exists() and proc.poll() is None:
            time.sleep(2)
        time.sleep(1)
        screenshot(a.out / "orca.png")
        windows = window_names()
        if proc.poll() is None:
            os.killpg(proc.pid, 9)
        proc.wait()

    for f in (data / "log").glob("*"):
        shutil.copy(f, a.out / f.name)
    debug = "\n".join(f.read_text(errors="replace") for f in (data / "log").glob("debug_*"))

    problems = []
    if f"[load_plugin_impl] SUCCESS plugin={PLUGIN_KEY}" not in debug:
        problems.append("OrcaSlicer did not log a successful load of the plugin")
    problems += [line.strip() for line in debug.splitlines() if f"FAIL plugin={PLUGIN_KEY}" in line]
    if not report.exists():
        problems.append(f"the probe wrote no report within {a.timeout} s (OrcaSlicer exit code {proc.returncode})")
    else:
        r = json.loads(report.read_text())
        print(json.dumps(r, indent=2))
        if not r.get("ok"):
            problems.append("probe failed: " + r.get("error", "?"))
        else:
            c = r["checks"]
            if not (c.get("module_loaded") and c.get("numpy") and c.get("page_bytes", 0) > 100_000):
                problems.append(f"plugin module incomplete: {c}")
            stl = [o for o in r["objects"] if o["name"] == a.mesh.name]
            if len(stl) != 1:
                problems.append(f"{a.mesh.name} not on the plate")
            else:
                faces = stl[0]["volumes"][0]["faces"]
                m = r["mesh"]
                if m["nF"] != faces or m["max_index"] != m["nV"] - 1 or m["bytes"] != m["nV"] * 12 + m["nF"] * 12:
                    problems.append(f"plugin returned a bad mesh: {m} (plate has {faces} faces)")
            ai = r.get("ai") or {}
            res = ai.get("result") or {}
            names = [x.get("name") for x in (res.get("result") or {}).get("parts", [])]
            if not (ai.get("status", {}).get("configured") and res.get("ok") and names == ["mock part 1", "mock part 2"]
                    and llm.requests and llm.requests[-1]["stream"]):
                problems.append(f"AI part naming via the local server failed: {ai}")
            if not (ai.get("test") or {}).get("ok") or (ai.get("test") or {}).get("models") != ["mock-vision-1"]:
                problems.append(f"AI connection test failed: {ai.get('test')}")
            if ai.get("stages") != ["permission", "sending", "waiting", "thinking", "writing"]:
                problems.append(f"AI progress stages: {ai.get('stages')}")
            cancel = ai.get("cancel") or {}
            if not (cancel.get("result") or {}).get("cancelled") or cancel.get("late") or not cancel.get("seconds", 99) < 5:
                problems.append(f"AI Cancel failed: {cancel}")
            want = split_parts(a.split_3mf)
            split = [o for o in r["objects"] if o["name"] != a.mesh.name]
            got = [v["name"] for v in split[0]["volumes"] if v["part"]] if len(split) == 1 else None
            if got != want:
                problems.append(f"{a.split_3mf.name} imported as {got}, expected one object with parts {want}")

    shutil.rmtree(data, ignore_errors=True)
    llm_ctx.__exit__(None, None, None)
    stall_ctx.__exit__(None, None, None)
    if problems:
        # Enough to diagnose a CI failure from the job log alone (a modal dialog shows up in the window list).
        print("Open windows: " + ", ".join(windows), file=sys.stderr)
        keep = re.compile(r"plugin|python|uv |AUDIT|error|warning|wizard|load_files", re.I)
        lines = [ln[:400] for ln in debug.splitlines() if keep.search(ln) and "preset" not in ln]
        print("--- OrcaSlicer log, plugin/error lines (last 80) ---\n" + "\n".join(lines[-80:]), file=sys.stderr)
        out = (a.out / "orca-stdout.log").read_text(errors="replace").splitlines()
        print("--- OrcaSlicer output (last 40 lines) ---\n" + "\n".join(ln[:400] for ln in out[-40:]), file=sys.stderr)
        print("FAILED in real OrcaSlicer:\n  - " + "\n  - ".join(problems), file=sys.stderr)
        sys.exit(1)
    print(f"OK: real OrcaSlicer loaded {a.plugin.name}, the plugin read the plate mesh, and "
          f"{a.split_3mf.name} imported as {len(want)} parts")


if __name__ == "__main__":
    main()
