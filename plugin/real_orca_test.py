#!/usr/bin/env python3
"""Install the built plugin in a real OrcaSlicer, start it, and check the plugin from the inside.

    python real_orca_test.py ORCA_APPRUN PLUGIN.py MESH.stl SPLIT.3mf [--out DIR] [--timeout S]

Needs an X display (CI runs it under xvfb-run). Uses a fresh OrcaSlicer data folder, installs
PLUGIN.py the way Plugins > Install local plugin does (orca_plugins/<file>/<file> + .install_state.json),
with the ~/Downloads write permission it asks for at load already granted (a modal prompt would block a
headless run), plus the CI-only real_orca_probe.py. OrcaSlicer opens MESH.stl and SPLIT.3mf from its
command line; the probe drives the plugin's Bridge with the real `orca` bindings and reports back.

Fails unless OrcaSlicer logs a successful load of the plugin, the probe gets the right mesh back from
the plugin, and OrcaSlicer imported SPLIT.3mf as one object with one part per split part.
Logs, the probe's report and a screenshot go to --out.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
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
    install(plugins, a.plugin.resolve(), "Mesh Splitter", {"fs_readwrite": [str(downloads / "*")]})
    install(plugins, HERE / "real_orca_probe.py", "Mesh Splitter CI probe", {"full_access": True})

    report = a.out / "probe.json"
    report.unlink(missing_ok=True)
    env = dict(os.environ, MESH_SPLITTER_PROBE_OUT=str(report.resolve()), LIBGL_ALWAYS_SOFTWARE="1",
               LANG=os.environ.get("LANG", "C.UTF-8"))
    with open(a.out / "orca-stdout.log", "w") as log:
        proc = subprocess.Popen([a.orca, "--datadir", str(data), str(a.mesh.resolve()), str(a.split_3mf.resolve())],
                                stdout=log, stderr=subprocess.STDOUT, env=env, start_new_session=True)
        t0 = time.time()
        while time.time() - t0 < a.timeout and not report.exists() and proc.poll() is None:
            time.sleep(2)
        time.sleep(1)
        screenshot(a.out / "orca.png")
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
            want = split_parts(a.split_3mf)
            split = [o for o in r["objects"] if o["name"] != a.mesh.name]
            got = [v["name"] for v in split[0]["volumes"] if v["part"]] if len(split) == 1 else None
            if got != want:
                problems.append(f"{a.split_3mf.name} imported as {got}, expected one object with parts {want}")

    shutil.rmtree(data, ignore_errors=True)
    if problems:
        print("FAILED in real OrcaSlicer:\n  - " + "\n  - ".join(problems), file=sys.stderr)
        sys.exit(1)
    print(f"OK: real OrcaSlicer loaded {a.plugin.name}, the plugin read the plate mesh, and "
          f"{a.split_3mf.name} imported as {len(want)} parts")


if __name__ == "__main__":
    main()
