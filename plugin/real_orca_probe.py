# /// script
# requires-python = ">=3.12"
#
# [tool.orcaslicer.plugin]
# name = "Mesh Splitter CI probe"
# description = "CI only: checks the installed Mesh Splitter plugin from inside a real OrcaSlicer."
# author = "d-carrigg"
# version = "0.0.1"
# ///
"""CI-only helper plugin for real_orca_test.py. Never shipped.

Installed next to the real mesh_splitter_any.py in a real OrcaSlicer. Once loaded it waits for the
models passed on OrcaSlicer's command line, then drives the Mesh Splitter plugin's own Bridge with
the real `orca` bindings (no fakes) and writes what it saw to $MESH_SPLITTER_PROBE_OUT as JSON:
  - the Mesh Splitter module loaded and its page decodes
  - "objects" lists the plate objects, "mesh" returns the right world-space mesh
  - the Mesh Splitter 3MF (made by e2e.mjs) imported as one object with one part per split part
  - AI part naming: settings saved, then a naming request sent from OrcaSlicer's Python (worker thread,
    urllib) to the mock OpenAI-compatible server at $MESH_SPLITTER_MOCK_LLM, as with LM Studio
"""
import base64
import json
import os
import sys
import tempfile
import threading
import time
import traceback

import orca

OUT = os.environ.get("MESH_SPLITTER_PROBE_OUT", "")


def model_objects():
    try:
        return list(orca.host.model().objects())
    except RuntimeError:  # "Plater is not available" until the main window is up
        return []


def probe():
    r = {"ok": False, "checks": {}}
    try:
        # Plugins load in parallel and the command-line models arrive later: wait for both.
        deadline = time.time() + 120
        while time.time() < deadline and (len(model_objects()) < 2 or "mesh_splitter_any" not in sys.modules):
            time.sleep(1)
        mod = sys.modules.get("mesh_splitter_any")
        r["checks"]["module_loaded"] = mod is not None
        if mod is None:
            raise RuntimeError("mesh_splitter_any is not in sys.modules: the plugin did not load")
        r["checks"]["page_bytes"] = len(mod.page_html())
        r["checks"]["numpy"] = mod.np is not None
        objs = model_objects()
        r["objects"] = [{"name": o.name, "volumes": [{"name": v.name, "part": bool(v.is_model_part()),
                                                     "faces": int(v.facets_count())} for v in o.volumes()]}
                        for o in objs]

        sent = []
        bridge = mod.Bridge(sent.append)
        bridge.handle({"cmd": "objects"})
        r["bridge_objects"] = sent[-1]

        src = next((i for i, o in enumerate(objs) if len(list(o.volumes())) == 1), None)
        if src is None:
            raise RuntimeError("no single-part object on the plate")
        sent.clear()
        bridge.handle({"cmd": "mesh", "index": src, "req": 1})
        if sent and sent[0].get("cmd") == "error":
            raise RuntimeError(sent[0]["message"])
        chunks = sorted(sent, key=lambda m: m["part"])
        data = base64.b64decode("".join(m["data"] for m in chunks))
        nV, nF = chunks[0]["nV"], chunks[0]["nF"]
        import numpy as np
        pos = np.frombuffer(data[:nV * 12], dtype="<f4").reshape(-1, 3)
        tri = np.frombuffer(data[nV * 12:], dtype="<u4").reshape(-1, 3)
        r["mesh"] = {"nV": nV, "nF": nF, "bytes": len(data), "max_index": int(tri.max()),
                     "size": [round(float(x), 2) for x in (pos.max(0) - pos.min(0))]}

        llm = os.environ.get("MESH_SPLITTER_MOCK_LLM")
        if llm:
            mod._storage[:] = [tempfile.mkdtemp(prefix="ms-ai-")]
            got = []
            ai = mod.Bridge(got.append)
            ai.handle({"cmd": "llm_settings", "settings": {"provider": "custom", "base_url": llm}})
            body = json.dumps({"images": ["data:image/jpeg;base64,AAAA"], "captions": ["front"],
                               "stats": {"parts": [{"id": 1}, {"id": 2}]}})
            ai.handle({"cmd": "llm_name", "id": "ci", "part": 0, "of": 1, "data": body})
            t = time.time()
            while time.time() - t < 30 and not any(m.get("cmd") == "llm_result" for m in got):
                time.sleep(0.2)
            r["ai"] = {"status": got[0], "result": next((m for m in got if m.get("cmd") == "llm_result"), None)}
        r["ok"] = True
    except Exception as e:
        r["error"] = f"{e}\n{traceback.format_exc()}"
    if OUT:
        with open(OUT, "w") as f:
            json.dump(r, f, indent=2)


class Probe(orca.script.ScriptPluginCapabilityBase):
    def get_name(self):
        return "Mesh Splitter CI probe"

    def on_load(self):
        threading.Thread(target=probe, daemon=True).start()

    def execute(self):
        return orca.ExecutionResult.skipped("CI only")


@orca.plugin
class ProbePlugin(orca.base):
    def register_capabilities(self):
        orca.register_capability(Probe)
