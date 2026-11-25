#!/usr/bin/env python3
"""OrcaSlicer plugin: plate mesh extraction, message chunking, saving (fake `orca` host, no OrcaSlicer)."""
import base64
import json
import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "server"))  # plugin.py imports llm_providers (inlined by build.py)
import fake_orca  # noqa: E402
import mock_llm_server  # noqa: E402

TET_V = np.array([[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]], float)
TET_F = np.array([[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]])


def load_plugin(objects):
    fake_orca.install(objects)
    spec = importlib.util.spec_from_file_location("mesh_splitter_plugin", HERE / "plugin.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def signed_volume(P, T):
    a, b, c = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6)


def reassemble(msgs):
    data = "".join(m["data"] for m in sorted(msgs, key=lambda m: m["part"]))
    raw = base64.b64decode(data)
    nV, nF = msgs[0]["nV"], msgs[0]["nF"]
    return (np.frombuffer(raw[:nV * 12], "<f4").reshape(-1, 3),
            np.frombuffer(raw[nV * 12:nV * 12 + nF * 12], "<u4").reshape(-1, 3))


class MeshTests(unittest.TestCase):
    def test_world_transform_and_parts(self):
        vol_m = np.eye(4); vol_m[:3, 3] = [5, 0, 0]
        inst = np.eye(4); inst[:3, :3] = [[0, -1, 0], [1, 0, 0], [0, 0, 1]]; inst[:3, 3] = [100, 50, 0]
        obj = fake_orca.FakeObject("thing", [
            fake_orca.FakeVolume(TET_V, TET_F, name="a"),
            fake_orca.FakeVolume(TET_V, TET_F, vol_m, name="b"),
            fake_orca.FakeVolume(TET_V, TET_F, name="mod", kind="modifier"),
        ], fake_orca.FakeInstance(inst))
        p = load_plugin([obj])
        groups = []
        P, T = p.object_mesh(obj, groups)
        self.assertEqual((len(P), len(T)), (8, 8))  # modifier skipped
        self.assertEqual([(g["name"], g["count"]) for g in groups], [("a", 4), ("b", 4)])  # the page keeps the parts
        np.testing.assert_allclose(P[1], [100, 60, 0])    # (10,0,0) rotated 90 deg about Z, offset
        np.testing.assert_allclose(P[5], [100, 65, 0])    # part b: (15,0,0) after its own offset
        self.assertEqual(int(T.min()), 0); self.assertEqual(int(T[4:].min()), 4)
        self.assertGreater(signed_volume(P, T), 0)

    def test_mirrored_instance_keeps_outward_normals(self):
        inst = np.diag([-1.0, 1, 1, 1])
        obj = fake_orca.FakeObject("m", [fake_orca.FakeVolume(TET_V, TET_F)], fake_orca.FakeInstance(inst))
        p = load_plugin([obj])
        P, T = p.object_mesh(obj)
        self.assertGreater(signed_volume(P, T), 0)

    def test_no_geometry(self):
        obj = fake_orca.FakeObject("empty", [fake_orca.FakeVolume(TET_V, TET_F, kind="modifier")])
        p = load_plugin([obj])
        with self.assertRaises(ValueError):
            p.object_mesh(obj)

    def test_chunks_round_trip(self):
        p = load_plugin([])
        p.CHUNK = 64
        P = np.random.default_rng(1).random((50, 3)).astype(np.float32)
        T = np.arange(60, dtype=np.uint32).reshape(-1, 3) % 50
        msgs = list(p.mesh_messages("x", P, T))
        self.assertGreater(len(msgs), 3)
        self.assertTrue(all(m["of"] == len(msgs) for m in msgs))
        P2, T2 = reassemble(msgs)
        np.testing.assert_array_equal(P, P2); np.testing.assert_array_equal(T, T2)


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        objs = [fake_orca.FakeObject("cube", [fake_orca.FakeVolume(TET_V, TET_F)]), fake_orca.FakeObject("", [])]
        self.p = load_plugin(objs)
        self.p.output_dir = lambda: self.tmp.name
        self.sent = []
        self.b = self.p.Bridge(self.sent.append)

    def tearDown(self):
        self.tmp.cleanup()

    def test_objects(self):
        self.b.handle({"cmd": "objects", "auto": True})
        m = self.sent[-1]
        self.assertTrue(m["auto"])
        objs = [{k: v for k, v in o.items() if k != "id"} for o in m["objects"]]
        self.assertEqual(objs, [{"index": 0, "name": "cube", "parts": 1, "faces": 4, "ignored": 0, "painted": False, "filaments": []},
                                {"index": 1, "name": "Object 2", "parts": 0, "faces": 0, "ignored": 0, "painted": False, "filaments": []}])
        self.assertNotEqual(m["objects"][0]["id"], m["objects"][1]["id"])
        self.assertEqual(m["filament_colors"], ["#FF0000", "#00AE42"])

    def test_mesh_and_errors(self):
        self.b.handle({"cmd": "mesh", "index": 0, "req": "r1"})
        self.assertTrue(all(m["req"] == "r1" for m in self.sent))
        P, T = reassemble([m for m in self.sent if m["cmd"] == "mesh"])
        self.assertEqual((len(P), len(T)), (4, 4))
        self.b.handle({"cmd": "mesh", "index": 7})
        self.assertEqual(self.sent[-1]["cmd"], "error")
        self.b.handle({"cmd": "mesh", "index": 1})
        self.assertIn("no model parts", self.sent[-1]["message"])

    def test_mesh_by_id_survives_reorder(self):
        import orca
        objs = orca.host.model()._objs
        oid = objs[0].id()
        objs.insert(0, fake_orca.FakeObject("new", []))  # index 0 is now a different object
        self.b.handle({"cmd": "mesh", "id": oid, "index": 0})
        self.assertEqual(self.sent[-1]["cmd"], "mesh")
        self.assertEqual(self.sent[-1]["name"], "cube")
        self.b.handle({"cmd": "mesh", "id": 999999})
        self.assertEqual(self.sent[-1]["cmd"], "error")

    def test_plate_events_reach_page(self):
        page = self.p.MeshSplitterPage()
        ev = type("Ev", (), {"name": "ObjectDeleted"})()
        page.on_lifecycle_event(ev, type("Ctx", (), {"id": "7", "index": 2})())
        self.assertEqual(page.posted[-1], {"cmd": "plate_changed", "event": "ObjectDeleted", "id": "7", "index": 2})
        page.on_lifecycle_event(type("Ev", (), {"name": "SliceStarted"})(), None)
        self.assertEqual(len(page.posted), 1)

    def test_save_chunks(self):
        data = base64.b64encode(bytes(range(256)) * 10).decode()
        for i, part in ((1, data[100:]), (0, data[:100])):  # out of order
            self.b.handle({"cmd": "save", "id": 3, "name": "../evil/x_parts.3mf", "part": i, "of": 2, "data": part})
        m = self.sent[-1]
        self.assertEqual(m["cmd"], "saved")
        self.assertEqual(m["path"], os.path.join(self.tmp.name, "x_parts.3mf"))
        self.assertEqual(Path(m["path"]).read_bytes(), bytes(range(256)) * 10)
        self.assertEqual(self.b.saves, {})
        self.b.handle({"cmd": "save", "id": 4, "name": "x_parts.3mf", "part": 0, "of": 1, "data": "AAAA"})
        self.assertEqual(self.sent[-1]["path"], os.path.join(self.tmp.name, "x_parts (2).3mf"))  # never overwrite
        import orca
        self.assertIn("x_parts (2).3mf", orca._state["notifications"][-1])

    def test_save_asks_where_with_the_system_dialog(self):
        asked = []
        chosen = os.path.join(self.tmp.name, "picked", "mine.stl")
        os.makedirs(os.path.dirname(chosen))
        self.p._storage[:] = [self.tmp.name]
        for mod, attr, val in ((self.p.savedialog, "supported", lambda: True), (self.p.handoff, "main_window", lambda: None),
                               (self.p.savedialog, "ask", lambda name, folder, owner: asked.append((name, folder)) or chosen)):
            patcher = mock.patch.object(mod, attr, val)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.b.handle({"cmd": "save", "id": 5, "name": "x_merged.stl", "part": 0, "of": 1, "data": "AAAA"})
        self.assertEqual(asked, [("x_merged.stl", self.tmp.name)])
        self.assertEqual(self.sent[-1], {"cmd": "saved", "id": 5, "path": chosen, "folder": os.path.dirname(chosen)})
        self.assertTrue(os.path.exists(chosen))
        self.p.savedialog.ask = lambda name, folder, owner: asked.append((name, folder)) and None  # undone by the patcher
        self.b.handle({"cmd": "save", "id": 6, "name": "x_merged.stl", "part": 0, "of": 1, "data": "AAAA"})
        self.assertEqual(asked[-1][1], os.path.dirname(chosen))  # starts where the last save went
        self.assertEqual(self.sent[-1], {"cmd": "saved", "id": 6, "cancelled": True})

    def test_save_dialog_failure_still_saves_to_downloads(self):
        def broken(*a):
            raise RuntimeError("Windows could not show the Save dialog (error 0x3002)")
        for mod, attr, val in ((self.p.savedialog, "supported", lambda: True), (self.p.handoff, "main_window", lambda: None),
                               (self.p.savedialog, "ask", broken)):
            patcher = mock.patch.object(mod, attr, val)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.b.handle({"cmd": "save", "id": 7, "name": "x.stl", "part": 0, "of": 1, "data": "AAAA"})
        m = self.sent[-1]
        self.assertEqual((m["cmd"], m["path"]), ("saved", os.path.join(self.tmp.name, "x.stl")))
        self.assertIn("0x3002", m["warn"])

    def test_save_dialog_filter(self):
        self.assertEqual(self.p.savedialog.filter_string("a.stl"), "STL file (*.stl)\0*.stl\0All files (*.*)\0*.*\0")

    def test_save_error_reported(self):
        self.p.output_dir = lambda: os.path.join(self.tmp.name, "missing")
        self.b.handle({"cmd": "save", "id": 1, "name": "a.3mf", "part": 0, "of": 1, "data": "AAAA"})
        self.assertEqual(self.sent[-1]["cmd"], "save_error")
        self.assertEqual(self.b.saves, {})

    def test_ignores_junk(self):
        self.b.handle("not a dict"); self.b.handle({"cmd": "nope"})
        self.assertEqual(self.sent, [])


class AiNamingTests(unittest.TestCase):
    """AI part naming inside OrcaSlicer: settings saved in the plugin's storage folder, request sent from Python."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        fake_orca.install([])
        self.p = load_plugin([])
        self.p._storage[:] = [self.tmp.name]
        self.sent, self.audits = [], []
        self.p.ask_network_permission = self.audits.append
        self.b = self.p.Bridge(self.sent.append)
        self.b.run_async = lambda work, on_error, done=None: (done or self.sent.append)(work())  # run inline

    def test_settings_round_trip_without_leaking_key(self):
        self.b.handle({"cmd": "llm_status"})
        self.assertEqual((self.sent[-1]["cmd"], self.sent[-1]["configured"]), ("llm_status", False))
        self.b.handle({"cmd": "llm_settings", "settings": {"provider": "openai", "api_key": "sk-secret", "model": "gpt-5-mini"}})
        st = self.sent[-1]
        self.assertEqual((st["provider"], st["configured"], st["has_key"]), ("openai", True, True))
        self.assertNotIn("sk-secret", str(self.sent))
        saved = Path(self.tmp.name, "ai_naming.json").read_text()
        self.assertIn("sk-secret", saved)  # persisted for the next session
        self.b.handle({"cmd": "llm_settings", "settings": {"provider": "custom", "base_url": "ftp://x"}})
        self.assertEqual((self.sent[-1]["cmd"], self.sent[-1]["ok"]), ("llm_status", False))

    def test_name_parts_against_local_server(self):
        with mock_llm_server.running() as srv:
            self.b.handle({"cmd": "llm_settings", "settings": {"provider": "custom", "base_url": srv.base_url}})
            self.b.handle({"cmd": "llm_test"})
            self.assertEqual(self.sent[-1], {"cmd": "llm_test", "ok": True, "models": ["mock-vision-1"]})
            body = json.dumps({"model": "", "images": ["data:image/jpeg;base64,AAAA"], "captions": ["front"],
                               "stats": {"parts": [{"id": 0}, {"id": 1}, {"id": 2}]}})
            half = len(body) // 2
            self.b.handle({"cmd": "llm_name", "id": "j1", "part": 1, "of": 2, "data": body[half:]})
            self.assertEqual(len(srv.requests), 0)
            self.b.handle({"cmd": "llm_name", "id": "j1", "part": 0, "of": 2, "data": body[:half]})
            out = self.sent[-1]
            self.assertEqual((out["cmd"], out["id"], out["ok"]), ("llm_result", "j1", True), out)
            self.assertEqual([x["name"] for x in out["result"]["parts"]], ["mock part 1", "mock part 2"])
            stages = [m["stage"] for m in self.sent if m["cmd"] == "llm_progress"]
            self.assertEqual(list(dict.fromkeys(stages)), ["permission", "sending", "waiting", "writing"])
            self.assertEqual(self.audits, [srv.base_url + "/models", srv.base_url + "/chat/completions"])
            self.assertEqual((self.b.llm_jobs, self.b.llm_running), ({}, {}))

    def test_cancel_stops_a_stalled_request(self):
        """A server that never answers: Cancel answers the page at once and shuts the connection."""
        import threading
        self.b.run_async = self.p.Bridge.run_async.__get__(self.b)  # real worker thread
        lock = threading.Lock()
        self.b.send = lambda m: (lock.acquire(), self.sent.append(m), lock.release())
        with mock_llm_server.running(stall=True) as srv:
            self.b.handle({"cmd": "llm_settings", "settings": {"provider": "custom", "base_url": srv.base_url}})
            self.b.handle({"cmd": "llm_name", "id": "j3", "part": 0, "of": 1, "data": json.dumps({"images": []})})
            for _ in range(100):
                if any(m.get("stage") == "waiting" for m in self.sent):
                    break
                threading.Event().wait(0.05)
            self.b.handle({"cmd": "llm_cancel", "id": "j3"})
            self.assertEqual(self.sent[-1], {"cmd": "llm_result", "id": "j3", "ok": False, "cancelled": True,
                                             "error": "Cancelled"})
            n = len(self.sent)
            threading.Event().wait(0.5)
        self.assertEqual(self.sent[n:], [])  # the worker's late result is dropped
        self.assertEqual(self.b.llm_running, {})

    def test_denied_permission_reported(self):
        def deny(url):
            raise PermissionError("audit permission required")
        self.p.ask_network_permission = deny
        self.b.handle({"cmd": "llm_name", "id": "j2", "part": 0, "of": 1, "data": "{}"})
        self.assertEqual((self.sent[-1]["cmd"], self.sent[-1]["ok"]), ("llm_result", False))
        self.assertIn("click Yes", self.sent[-1]["error"])


class RegistrationTests(unittest.TestCase):
    def register(self, ai_settings):
        p = load_plugin([])
        import orca
        p.load_ai_settings = lambda: ai_settings
        with mock.patch.object(os.path, "expanduser", return_value=os.path.join("C:", "Users", "d")):
            p.MeshSplitterPlugin().register_capabilities()
        return orca._state["permissions"]

    def test_no_network_declared_until_ai_naming_is_set_up(self):
        import handoff
        self.assertEqual(self.register({}), [{
            "fs_readwrite": [os.path.join("C:", "Users", "d", "Downloads", "*")], "process": handoff.PROCESSES,
            "network": [], "threading": False}])

    def test_declares_only_the_saved_provider_host(self):
        perms = self.register({"provider": "openrouter", "providers": {"openrouter": {"api_key": "k"}}})
        self.assertEqual(perms[0]["network"], ["https://openrouter.ai"])
        self.assertTrue(perms[0]["threading"])
        custom = self.register({"provider": "custom", "providers": {"custom": {"base_url": "http://localhost:1234/v1"}}})
        self.assertEqual(custom[0]["network"], ["http://localhost"])

    def test_real_orca_check_can_grant_everything_the_plugin_requests(self):
        import real_orca_test
        unknown = set(self.register({"provider": "openrouter", "providers": {"openrouter": {"api_key": "k"}}})[0]) - set(real_orca_test.GRANT_KEYS)
        self.assertFalse(unknown, f"add {sorted(unknown)} to GRANT_KEYS in real_orca_test.py, "
                                  "or the real OrcaSlicer check stalls on the permissions prompt")

    def test_window_and_page_share_bridge(self):
        p = load_plugin([fake_orca.FakeObject("cube", [fake_orca.FakeVolume(TET_V, TET_F)])])
        p.page_html = lambda: "<html></html>"
        import orca
        r = p.OpenMeshSplitter().execute()
        self.assertEqual(r.kind, "success")
        w = orca._state["windows"][0]
        w.kw["on_message"]({"cmd": "objects"})
        self.assertEqual(w.posted[-1]["objects"][0]["name"], "cube")
        self.assertEqual(p.OpenMeshSplitter().execute().kind, "skipped")
        page = p.MeshSplitterPage()
        page.on_message({"cmd": "objects"})
        self.assertEqual(page.posted[-1]["cmd"], "objects")


class BuildTests(unittest.TestCase):
    def test_build_writes_plain_wheel_with_self_contained_page(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "mesh_splitter_any.whl"
            import subprocess, zipfile
            subprocess.run([sys.executable, str(HERE / "build.py"), "--version", "9.9.9", "--name", "meshsplitter", "--out", str(out),
                            "--page-out", str(Path(d) / "not" / "made" / "yet" / "page.html")],
                           check=True, capture_output=True)
            z = zipfile.ZipFile(out)
            info = "mesh_splitter_any-9.9.9.dist-info/"
            self.assertEqual(sorted(z.namelist()), sorted([
                "mesh_splitter_any/__init__.py", "mesh_splitter_any/page.html",
                "mesh_splitter_any/handoff.py", "mesh_splitter_any/project3mf.py", "mesh_splitter_any/savedialog.py",
                info + "METADATA", info + "WHEEL", info + "top_level.txt", info + "RECORD", info + "LICENSE"]))
            meta = z.read(info + "METADATA").decode()
            for line in ("Name: Mesh Splitter", "Version: 9.9.9", "Author: d-carrigg", "License: MIT", "Requires-Dist: numpy"):
                self.assertIn(line, meta)
            self.assertIn("Tag: py3-none-any", z.read(info + "WHEEL").decode())
            self.assertIn("Copyright (c) 2026 Darin Carrigg", z.read(info + "LICENSE").decode())
            z.extractall(d)
            fake_orca.install([])
            sys.path.insert(0, d)  # OrcaSlicer imports the package by name (top_level.txt)
            try:
                for name in [n for n in sys.modules if n == "mesh_splitter_any" or n.startswith("mesh_splitter_any.")]:
                    del sys.modules[name]
                mod = importlib.import_module("mesh_splitter_any")
            finally:
                sys.path.remove(d)
            self.assertTrue(mod.project3mf.__file__.startswith(d))
            html = mod.page_html()
            self.assertNotIn("cdn.jsdelivr.net", html)
            self.assertNotIn('type="importmap"', html)
            self.assertLess(len(html.encode()), 1_800_000)
            self.assertIn("Official build by", html)

    def test_build_without_official_flag_is_an_unofficial_copy(self):
        import subprocess, zipfile
        with tempfile.TemporaryDirectory() as d:
            env = {k: v for k, v in os.environ.items() if k != "MESH_SPLITTER_NAME"}
            subprocess.run([sys.executable, str(HERE / "build.py"), "--version", "9.9.9", "--out", str(Path(d) / "x.whl")],
                           check=True, capture_output=True, env=env)
            z = zipfile.ZipFile(Path(d) / "x.whl")
            info = "mesh_splitter_copy_any-9.9.9.dist-info/"
            self.assertEqual(z.read(info + "top_level.txt").decode(), "mesh_splitter_copy_any\n")
            self.assertIn("Name: Mesh Splitter (unofficial copy)\n", z.read(info + "METADATA").decode())
            html = z.read("mesh_splitter_copy_any/page.html").decode()
            self.assertNotIn("Official build by", html)
            self.assertIn("Unofficial copy.", html)


# ---------------------------------------------------------------- Send to Orca (handoff.py, project3mf.py)

CUBE_V = [(0, 0, 0), (10, 0, 0), (10, 10, 0), (0, 10, 0), (0, 0, 10), (10, 0, 10), (10, 10, 10), (0, 10, 10)]
CUBE_F = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6),
          (3, 0, 4), (3, 4, 7)]


def zip_bytes(files):
    import io, zipfile
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for n, t in files.items():
            z.writestr(n, t)
    return out.getvalue()


def split_3mf(parts, name="thing"):
    """The page's multi-part 3MF (parts3MF in app/export.js): [(part name, filament, (dx, dy, dz))] of cubes."""
    objs, comps, cfg = [], [], []
    for k, (pname, fil, (dx, dy, dz)) in enumerate(parts):
        v = "".join(f'<vertex x="{x + dx}" y="{y + dy}" z="{z + dz}"/>' for x, y, z in CUBE_V)
        t = "".join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in CUBE_F)
        objs.append(f'<object id="{k + 1}" type="model" name="{pname}"><mesh><vertices>{v}</vertices><triangles>{t}</triangles></mesh></object>')
        comps.append(f'<component objectid="{k + 1}"/>')
        cfg.append(f'<part id="{k + 1}" subtype="normal_part"><metadata key="name" value="{pname}"/><metadata key="extruder" value="{fil}"/></part>')
    parent = len(parts) + 1
    model = (f'<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="{CORE}"><resources>{"".join(objs)}'
             f'<object id="{parent}" type="model" name="{name}"><components>{"".join(comps)}</components></object></resources>'
             f'<build><item objectid="{parent}"/></build></model>')
    config = f'<?xml version="1.0" encoding="UTF-8"?><config><object id="{parent}"><metadata key="name" value="{name}"/>{"".join(cfg)}</object></config>'
    return zip_bytes({"3D/3dmodel.model": model, "Metadata/model_settings.config": config})


CORE = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
PROD = "http://schemas.microsoft.com/3dmanufacturing/production/2015/06"


def orca_project(objects, plates=1, bed=256):
    """An OrcaSlicer 2.5 project 3MF as export_3mf_copy writes it (layout copied from a real export): each object's
    meshes in 3D/Objects/<name>_<id>.model, components + build items in 3D/3dmodel.model, names, filaments and
    plate membership in Metadata/model_settings.config. objects: [(name, plate index, (x, y))]."""
    files, comps, items, cfg, rels = {}, [], [], [], []
    plate_items = {p: [] for p in range(plates)}
    for k, (name, plate, (x, y)) in enumerate(objects):
        mesh_id, oid = 2 * k + 1, 2 * k + 2
        path = f"/3D/Objects/{name}_{oid}.model"
        v = "".join(f'<vertex x="{a}" y="{b}" z="{c}"/>' for a, b, c in CUBE_V)
        t = "".join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in CUBE_F)
        files[path[1:]] = (f'<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="{CORE}" xmlns:p="{PROD}" '
                           f'requiredextensions="p"><resources><object id="{mesh_id}" type="model"><mesh><vertices>{v}</vertices>'
                           f'<triangles>{t}</triangles></mesh></object></resources><build/></model>')
        rels.append(f'<Relationship Target="{path}" Id="rel-{oid}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>')
        comps.append(f'<object id="{oid}" p:UUID="x" type="model"><components><component p:path="{path}" objectid="{mesh_id}" '
                     f'transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object>')
        items.append(f'<item objectid="{oid}" transform="1 0 0 0 1 0 0 0 1 {x} {y} 0" printable="1"/>')
        cfg.append(f'<object id="{oid}"><metadata key="name" value="{name}"/><metadata key="extruder" value="1"/>'
                   f'<part id="{mesh_id}" subtype="normal_part"><metadata key="name" value="{name}"/></part></object>')
        plate_items[plate].append(f'<model_instance><metadata key="object_id" value="{oid}"/><metadata key="instance_id" value="0"/>'
                                  f'<metadata key="identify_id" value="{100 + k}"/></model_instance>')
    plates_xml = "".join(f'<plate><metadata key="plater_id" value="{p + 1}"/>{"".join(plate_items[p])}</plate>' for p in range(plates))
    files.update({
        "[Content_Types].xml": "<Types/>", "_rels/.rels": "<Relationships/>",
        "3D/3dmodel.model": (f'<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="{CORE}" xmlns:p="{PROD}" '
                             f'requiredextensions="p"><resources>{"".join(comps)}</resources><build>{"".join(items)}</build></model>'),
        "3D/_rels/3dmodel.model.rels": f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{"".join(rels)}</Relationships>',
        "Metadata/model_settings.config": f'<?xml version="1.0" encoding="UTF-8"?><config>{"".join(cfg)}{plates_xml}<assemble/></config>',
        "Metadata/project_settings.config": json.dumps({"printable_area": ["0x0", f"{bed}x0", f"{bed}x{bed}", f"0x{bed}"],
                                                        "filament_colour": ["#FF0000"], "filament_settings_id": ["Generic PLA"],
                                                        "filament_type": ["PLA"], "flush_volumes_matrix": ["0"],
                                                        "flush_volumes_vector": ["140", "140"], "layer_height": "0.2"}),
    })
    return zip_bytes(files)


def read_3mf(data):
    """(object names in build order, [(object name, [part (name, filament)], [instance (x, y)])]) of a 3MF."""
    import io, zipfile, xml.etree.ElementTree as ET
    z = zipfile.ZipFile(io.BytesIO(data))
    root, cfg = ET.fromstring(z.read("3D/3dmodel.model")), ET.fromstring(z.read("Metadata/model_settings.config"))
    q = lambda t: f"{{{CORE}}}{t}"
    names = {o.get("id"): next((m.get("value") for m in o.findall("metadata") if m.get("key") == "name"), None)
             for o in cfg.findall("object")}
    out = {}
    for it in root.find(q("build")).findall(q("item")):
        t = [float(x) for x in it.get("transform").split()]
        out.setdefault(it.get("objectid"), []).append((round(t[9], 3), round(t[10], 3)))
    parts = {o.get("id"): [(next(m.get("value") for m in p.findall("metadata") if m.get("key") == "name"),
                            next((m.get("value") for m in p.findall("metadata") if m.get("key") == "extruder"), None))
                           for p in o.findall("part")] for o in cfg.findall("object")}
    return [(names[oid], parts[oid], inst) for oid, inst in out.items()], z.namelist()


class Project3mfTests(unittest.TestCase):
    SPLIT = split_3mf([("Body", 2, (100, 100, 0)), ("Head", 5, (100, 100, 10))])  # 10x10x20 at (100..110, 100..110)

    def apply(self, proj, mode, index, **kw):
        import project3mf
        out, info = project3mf.apply(proj, self.SPLIT, mode, index, **kw)
        return read_3mf(out), out, info

    def test_replace_object_puts_the_split_in_its_place(self):
        proj = orca_project([("cube", 0, (50, 50)), ("bolt", 0, (150, 50))])
        (objs, names), out, info = self.apply(proj, "replace_object", 1, name="bolt split", object_name="bolt")
        self.assertEqual(objs, [("cube", [("cube", None)], [(50.0, 50.0)]),
                                ("bolt split", [("Body", "2"), ("Head", "5")], [(105.0, 105.0)])])  # where it was split
        self.assertNotIn("3D/Objects/bolt_4.model", names)  # the original's meshes went with it
        self.assertIn("3D/Objects/cube_2.model", names)
        import zipfile, io
        z = zipfile.ZipFile(io.BytesIO(out))
        self.assertNotIn(b"bolt_4", z.read("3D/_rels/3dmodel.model.rels"))
        cfg = z.read("Metadata/model_settings.config").decode()
        self.assertNotIn('value="4"', cfg)
        self.assertLess(cfg.rindex("<object"), cfg.index("<plate"))  # OrcaSlicer reads objects before plates
        self.assertEqual(cfg.count('key="object_id"'), 2)  # both on plate 1
        self.assertEqual(info, {"removed": 1, "copies": 1, "plate": 1, "parts": 2, "filaments_added": 4,
                                "source_at": {"index": 1, "name": "bolt split"}})  # where OrcaSlicer will list it

    def test_single_part_goes_on_the_originals_filament(self):
        one = split_3mf([("bolt", 3, (100, 100, 0))])  # the page's one-part export (slot from the page is ignored)
        proj = orca_project([("bolt", 0, (150, 50))])
        import project3mf
        out, info = project3mf.apply(proj, one, "replace_object", 0, object_name="bolt", single=True)
        self.assertEqual(read_3mf(out)[0], [("bolt", [("bolt", "1")], [(105.0, 105.0)])])
        self.assertEqual(info["filaments_added"], 0)

    def test_painted_part_keeps_its_paint_and_adds_the_slots_it_uses(self):
        import project3mf, zipfile, io
        v = "".join(f'<vertex x="{x + 100}" y="{y + 100}" z="{z}"/>' for x, y, z in CUBE_V)
        t = "".join(f'<triangle v1="{a}" v2="{b}" v3="{c}" paint_color="{"8" if k < 6 else "1C"}"/>' for k, (a, b, c) in enumerate(CUBE_F))
        painted = zip_bytes({"3D/3dmodel.model": f'<?xml version="1.0"?><model unit="millimeter" xmlns="{CORE}"><resources>'
                             f'<object id="1" type="model" name="bolt"><mesh><vertices>{v}</vertices><triangles>{t}</triangles>'
                             f'</mesh></object></resources><build><item objectid="1"/></build></model>'})
        self.assertEqual([project3mf.paint_state(c) for c in ("4", "8", "0C", "1C", "7C", "0FC", "0FFC")], [1, 2, 3, 4, 10, 18, 33])
        out, info = project3mf.apply(orca_project([("bolt", 0, (150, 50))]), painted, "replace_object", 0,
                                     object_name="bolt", single=True)
        z = zipfile.ZipFile(io.BytesIO(out))
        sub, = [n for n in z.namelist() if n.startswith("3D/Objects/")]
        self.assertEqual(z.read(sub).decode().count('paint_color="1C"'), 6)
        self.assertEqual(read_3mf(out)[0], [("bolt", [("bolt", "1")], [(105.0, 105.0)])])
        self.assertEqual(info["filaments_added"], 3)  # slots 2..4

    def test_new_filament_slots_extend_every_per_filament_setting(self):
        proj = orca_project([("bolt", 0, (150, 50))])
        _, out, _ = self.apply(proj, "replace_object", 0, colors={2: "#00ff00"})
        import zipfile, io
        st = json.loads(zipfile.ZipFile(io.BytesIO(out)).read("Metadata/project_settings.config"))
        self.assertEqual(st["filament_settings_id"], ["Generic PLA"] * 5)
        self.assertEqual(st["filament_type"], ["PLA"] * 5)
        self.assertEqual(st["filament_colour"][:2], ["#FF0000", "#00ff00"])  # the page's color for slot 2
        self.assertEqual(len(st["flush_volumes_matrix"]), 25)
        self.assertEqual(st["flush_volumes_matrix"][1], "280")  # no existing volume to copy: OrcaSlicer's default
        self.assertEqual(st["flush_volumes_matrix"][6], "0")  # diagonal
        self.assertEqual(len(st["flush_volumes_vector"]), 10)
        self.assertEqual(st["layer_height"], "0.2")

    def test_add_keeps_the_original(self):
        proj = orca_project([("bolt", 0, (150, 50))])
        (objs, _), _, info = self.apply(proj, "add", 0, object_name="bolt")
        self.assertEqual([(o[0], o[2]) for o in objs], [("bolt", [(150.0, 50.0)]), ("bolt", [(125.0, 105.0)])])  # +10 mm wide +10
        self.assertEqual(info["removed"], 0)

    def test_add_goes_left_when_the_right_is_off_the_plate(self):
        split = split_3mf([("Body", 2, (240, 100, 0))])  # 240..250 on a 256 mm bed
        proj = orca_project([("bolt", 0, (245, 105))])
        import project3mf
        out, _ = project3mf.apply(proj, split, "add", 0, object_name="bolt")
        self.assertEqual(read_3mf(out)[0][-1][2], [(225.0, 105.0)])

    def test_add_without_a_source_goes_to_the_middle_of_plate_1(self):
        proj = orca_project([("bolt", 0, (150, 50))], bed=200)
        (objs, _), _, _ = self.apply(proj, "add", None, name="thing")
        self.assertEqual(objs[-1][0::2], ("thing", [(100.0, 100.0)]))

    def test_replace_plate_clears_only_that_plate(self):
        proj = orca_project([("a", 0, (50, 50)), ("b", 1, (350, 50)), ("c", 1, (400, 50))], plates=2)
        (objs, _), out, info = self.apply(proj, "replace_plate", 1, object_name="b")
        self.assertEqual([o[0] for o in objs], ["a", "b"])  # the split, named after the source
        self.assertEqual((info["removed"], info["plate"]), (2, 2))
        import zipfile, io
        import xml.etree.ElementTree as ET
        plates = ET.fromstring(zipfile.ZipFile(io.BytesIO(out)).read("Metadata/model_settings.config")).findall("plate")
        self.assertEqual([len(p.findall("model_instance")) for p in plates], [1, 1])  # the split is on plate 2

    def test_fill_plate_tiles_copies_on_the_right_plate(self):
        proj = orca_project([("a", 0, (50, 50)), ("b", 1, (350, 50))], plates=2, bed=100)
        (objs, _), _, info = self.apply(proj, "fill_plate", 1, object_name="b")
        copies = [o for o in objs if o[0] == "b"]
        # one object per copy, each with its own name and filaments
        self.assertEqual({(tuple(p), len(i)) for _, p, i in copies}, {((("Body", "2"), ("Head", "5")), 1)})
        inst = [i[0] for _, _, i in copies]
        # 10 mm parts, 6 mm apart on a 100 mm bed: 6 x 6; plate 2 starts 1.2 bed widths to the right
        self.assertEqual(info["copies"], 36)
        self.assertEqual(len(inst), 36)
        xs, ys = sorted({x for x, _ in inst}), sorted({y for _, y in inst})
        self.assertAlmostEqual(xs[0] - 5, 120 + (100 - (6 * 10 + 5 * 6)) / 2)
        self.assertAlmostEqual(xs[1] - xs[0], 16)
        self.assertAlmostEqual(ys[0] - 5, (100 - 90) / 2)

    def test_fill_skips_the_excluded_corner(self):
        import project3mf
        parts = project3mf.read_split(self.SPLIT)
        full = project3mf.fill_offsets(parts, (0, 0, 100, 100), (0, 0))
        cut = project3mf.fill_offsets(parts, (0, 0, 100, 100), (0, 0), [(0, 0, 18, 28)])  # X1-style purge corner
        self.assertEqual(len(full) - len(cut), 2)  # copies at x 5..15 and y 5..15, 21..31 touch (0..18, 0..28)

    def test_resolve_checks_the_name(self):
        import project3mf
        proj = orca_project([("cube", 0, (50, 50))])
        with self.assertRaisesRegex(ValueError, "changed"):
            project3mf.apply(proj, self.SPLIT, "replace_object", 0, object_name="bolt")
        with self.assertRaisesRegex(ValueError, "no longer"):
            project3mf.apply(proj, self.SPLIT, "replace_object", 3)

    def test_handoff_payload_is_orcas_command_line(self):
        import handoff
        self.assertEqual(handoff.payload([r'C:\Users\d\Downloads\a "b".3mf']),
                         r'"orca-slicer";"C:\\Users\\d\\Downloads\\a \"b\".3mf"')


class SendToOrcaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.objs = [fake_orca.FakeObject("cube", []), fake_orca.FakeObject("bolt", [])]
        self.p = load_plugin(self.objs)
        self.p.output_dir = lambda: self.tmp.name
        self.store = tempfile.TemporaryDirectory()
        self.addCleanup(self.store.cleanup)
        self.p._storage[:] = [self.store.name]  # the project copy is made in the plugin's own folder
        import orca
        orca._state["project"] = orca_project([("cube", 0, (50, 50)), ("bolt", 0, (150, 50))])
        orca._state["project_path"] = "/home/d/prints/desk toy.3mf"
        self.sent, self.handed = [], []
        self.p.handoff.send = self.handed.append
        self.p.handoff.supported = lambda: True
        self.b = self.p.Bridge(self.sent.append)

    def send(self, mode, obj=None):
        data = base64.b64encode(Project3mfTests.SPLIT).decode()
        src = {"id": obj.id(), "index": 0, "name": obj.name} if obj else None
        self.b.handle({"cmd": "save", "id": 1, "name": "bolt_parts.3mf", "part": 0, "of": 1, "data": data,
                       "mode": mode, "source": src, "colors": {"2": "#00ff00"}})
        return self.sent[-1]

    def test_replace_hands_over_the_edited_project(self):
        m = self.send("replace_object", self.objs[1])  # found by id, though the page said index 0
        path, = self.handed[0]
        self.assertEqual(os.path.basename(path), "desk toy - Mesh Splitter.3mf")
        self.assertEqual([o[0] for o in read_3mf(Path(path).read_bytes())[0]], ["cube", "bolt"])
        self.assertEqual((m["cmd"], m["ask"], m["path"]), ("saved", "Open as project", path))
        self.assertIn("Open as project", m["note"])
        self.assertEqual(os.listdir(self.tmp.name).count(".mesh-splitter-project.3mf"), 0)  # the copy is cleaned up
        self.assertEqual(os.listdir(self.store.name), [])

    def test_next_send_finds_the_model_after_orca_reopens_the_project(self):
        import orca
        m = self.send("replace_plate", self.objs[1])
        self.assertEqual(m["source"], {"index": 0, "name": "bolt"})  # plate cleared, the split is the only object
        # OrcaSlicer opens the sent project: every object gets a new id
        orca.host.model()._objs[:] = [fake_orca.FakeObject("bolt", [])]
        orca._state["project"] = Path(self.handed[0][0]).read_bytes()
        orca._state["project_path"] = self.handed[0][0]
        data = base64.b64encode(Project3mfTests.SPLIT).decode()
        self.b.handle({"cmd": "save", "id": 2, "name": "bolt_parts.3mf", "part": 0, "of": 1, "data": data,
                       "mode": "replace_plate", "source": {"id": None, **m["source"]}})
        m2 = self.sent[-1]
        self.assertEqual(m2["cmd"], "saved", m2)
        self.assertEqual(os.path.basename(m2["path"]), "desk toy - Mesh Splitter (2).3mf")  # the name doesn't grow
        # also when the page still has the stale id
        self.b.handle({"cmd": "save", "id": 3, "name": "bolt_parts.3mf", "part": 0, "of": 1, "data": data,
                       "mode": "add", "source": {"id": 424242, "index": 0, "name": "bolt"}})
        self.assertEqual(self.sent[-1]["cmd"], "saved", self.sent[-1])
        self.assertEqual(self.sent[-1]["source"], {"index": 0, "name": "bolt"})  # after an add: still the original

    def test_add_without_a_source(self):
        m = self.send("add")
        self.assertEqual(m["cmd"], "saved")
        self.assertEqual([o[0] for o in read_3mf(Path(self.handed[0][0]).read_bytes())[0]], ["cube", "bolt", "bolt"])

    def deleted_original(self):
        """The user deleted the object the split came from in OrcaSlicer (Delete key) before sending."""
        import orca
        bolt = self.objs.pop(1)
        orca.host.model()._objs[:] = self.objs
        orca._state["project"] = orca_project([("cube", 0, (50, 50))])
        return bolt

    def test_every_send_works_after_the_original_was_deleted(self):
        # the split goes where it was on the plate; nothing else is removed except what the mode clears
        want = {"add": ["cube", "bolt"], "replace_object": ["cube", "bolt"], "replace_plate": ["bolt"]}
        for mode, names in want.items():
            with self.subTest(mode=mode):
                self.setUp()
                bolt = self.deleted_original()
                m = self.send(mode, bolt)
                self.assertEqual(m["cmd"], "saved", m)
                objs = read_3mf(Path(self.handed[-1][0]).read_bytes())[0]
                self.assertEqual([o[0] for o in objs], names)
                self.assertEqual(objs[-1][2], [(105.0, 105.0)])  # where it was split
                self.assertEqual(m["source"], {"index": len(names) - 1, "name": "bolt"})  # the next send finds it
        self.setUp()
        m = self.send("fill_plate", self.deleted_original())
        self.assertEqual(m["cmd"], "saved", m)
        objs = read_3mf(Path(self.handed[-1][0]).read_bytes())[0]
        self.assertEqual({o[0] for o in objs}, {"bolt"})  # the plate is cleared and filled
        self.assertGreater(len(objs), 1)

    def test_send_after_deleting_the_split_that_was_sent(self):
        # Replace plate, then delete what was sent in OrcaSlicer, then Replace plate again: the page's source now
        # names the sent split, which is gone
        import orca
        m = self.send("replace_plate", self.objs[1])
        orca.host.model()._objs[:] = []
        orca._state["project"] = orca_project([])
        data = base64.b64encode(Project3mfTests.SPLIT).decode()
        self.b.handle({"cmd": "save", "id": 2, "name": "bolt_parts.3mf", "part": 0, "of": 1, "data": data,
                       "mode": "replace_plate", "source": {"id": None, **m["source"]}})
        self.assertEqual(self.sent[-1]["cmd"], "saved", self.sent[-1])
        self.assertEqual([o[0] for o in read_3mf(Path(self.handed[-1][0]).read_bytes())[0]], ["bolt"])

    def test_plate_under_a_point(self):
        import project3mf
        proj = project3mf.Project(orca_project([("cube", 0, (50, 50)), ("bolt", 1, (50, 50))], plates=2))
        x0, y0 = proj.plate_origin(1)
        self.assertEqual(proj.plate_at((x0 + 100, y0 + 100)), 1)
        self.assertEqual(proj.plate_at((100, 100)), 0)
        self.assertEqual(proj.plate_at((-5000, -5000)), 0)  # off every plate: the first

    def test_without_handoff_the_project_is_saved(self):
        self.p.handoff.supported = lambda: False
        m = self.send("add")
        self.assertEqual(self.handed, [])
        self.assertIn("File > Open Project", m["note"])

    def test_unreachable_orca_still_says_where_the_project_is(self):
        def down(files):
            raise RuntimeError("OrcaSlicer was not found on the session bus")
        self.p.handoff.send = down
        m = self.send("add")
        self.assertEqual(m["cmd"], "saved")
        self.assertTrue(os.path.exists(m["path"]))
        self.assertIn("File > Open Project", m["note"])
        self.assertIn(os.path.basename(m["path"]), m["note"])
        self.assertTrue(m["warn"])


class ReleaseNotesTests(unittest.TestCase):
    def test_release_please_notes_become_plain_lines(self):
        from release_notes import plain_changelog
        md = ("## [0.3.7](https://github.com/d-carrigg/mesh-splitter/compare/v0.3.6...v0.3.7) (2026-11-20)\n\n\n"
              "### Features\n\n* **app:** add `undo` ([#20](https://github.com/x/y/issues/20)) "
              "([abc1234](https://github.com/x/y/commit/abc1234def))\n\n"
              "### Bug Fixes\n\n* send OrcaCloud release metadata with --form-string "
              "([#17](https://github.com/x/y/issues/17)) ([cbb5cd1](https://github.com/x/y/commit/cbb5cd1a4aa0))")
        self.assertEqual(plain_changelog(md),
                         "- New: App: add undo\n- Fix: Send OrcaCloud release metadata with --form-string")

    def test_plain_lines_pass_through(self):
        from release_notes import plain_changelog
        self.assertEqual(plain_changelog("- Faster splitting\n- Fix crash"), "- Faster splitting\n- Fix crash")


if __name__ == "__main__":
    unittest.main()
