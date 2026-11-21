"""Run plugin.py's Bridge against fake_orca over stdin/stdout JSON lines (end-to-end test host).

    python fake_host.py MESH.stl|MESH.3mf [--out DIR]

Each stdin line is one page -> plugin message; each stdout line is one plugin -> page message.
The mesh is put on the fake plate rotated 90 deg about Z and offset, so world transforms are exercised.
"""
import argparse
import importlib.util
import json
import os
import sys
import threading
from pathlib import Path

import numpy as np
import trimesh

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "server"))  # llm_providers (inlined in the built plugin)
import fake_orca  # noqa: E402


def load_plugin():
    spec = importlib.util.spec_from_file_location("mesh_splitter_plugin", HERE / "plugin.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mesh")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    m = trimesh.load(a.mesh, force="mesh", process=False)
    inst = np.eye(4)
    inst[:3, :3] = [[0, -1, 0], [1, 0, 0], [0, 0, 1]]
    inst[:3, 3] = [128, 128, 0]
    fake_orca.install([fake_orca.FakeObject(Path(a.mesh).stem, [fake_orca.FakeVolume(m.vertices, m.faces)],
                                            fake_orca.FakeInstance(inst))])
    plugin = load_plugin()
    plugin.output_dir = lambda: a.out
    plugin._storage[:] = [a.out]  # AI naming settings land next to the outputs, not in the real temp folder
    out, lock = sys.stdout, threading.Lock()

    def send(msg):  # AI naming replies come from a worker thread
        with lock:
            out.write(json.dumps(msg) + "\n")
            out.flush()

    bridge = plugin.Bridge(send)
    for line in sys.stdin:
        if line.strip():
            bridge.handle(json.loads(line))


if __name__ == "__main__":
    main()
