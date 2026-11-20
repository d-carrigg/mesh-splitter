#!/usr/bin/env python3
"""OrcaSlicer plugin: plate mesh extraction, message chunking, saving (fake `orca` host, no OrcaSlicer)."""
import base64
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
import fake_orca  # noqa: E402

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
        P, T = p.object_mesh(obj)
        self.assertEqual((len(P), len(T)), (8, 8))  # modifier skipped
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
        self.assertEqual(objs, [{"index": 0, "name": "cube", "parts": 1, "faces": 4, "ignored": 0},
                                {"index": 1, "name": "Object 2", "parts": 0, "faces": 0, "ignored": 0}])
        self.assertNotEqual(m["objects"][0]["id"], m["objects"][1]["id"])
        self.assertEqual(m["filament_colours"], ["#FF0000", "#00AE42"])

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

    def test_save_error_reported(self):
        self.p.output_dir = lambda: os.path.join(self.tmp.name, "missing")
        self.b.handle({"cmd": "save", "id": 1, "name": "a.3mf", "part": 0, "of": 1, "data": "AAAA"})
        self.assertEqual(self.sent[-1]["cmd"], "save_error")
        self.assertEqual(self.b.saves, {})

    def test_ignores_junk(self):
        self.b.handle("not a dict"); self.b.handle({"cmd": "nope"})
        self.assertEqual(self.sent, [])


class RegistrationTests(unittest.TestCase):
    def test_registers_page_and_script_with_download_permission(self):
        p = load_plugin([])
        import orca
        with mock.patch.object(os.path, "expanduser", return_value=os.path.join("C:", "Users", "d")):
            p.MeshSplitterPlugin().register_capabilities()
        st = orca._state
        self.assertEqual(st["capabilities"], [p.MeshSplitterPage, p.OpenMeshSplitter])
        self.assertEqual(st["permissions"], [{"fs_readwrite": [os.path.join("C:", "Users", "d", "Downloads", "*")]}])

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
    @unittest.skipUnless((HERE / "node_modules" / "three").is_dir(), "run npm ci in tools/orca_plugin first")
    def test_build_embeds_self_contained_page(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "mesh_splitter.py"
            import subprocess
            subprocess.run([sys.executable, str(HERE / "build.py"), "--version", "9.9.9", "--out", str(out)], check=True,
                           capture_output=True)
            src = out.read_text()
            self.assertIn('version = "9.9.9"', src)
            fake_orca.install([])
            spec = importlib.util.spec_from_file_location("built", out)
            mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
            html = mod.page_html()
            self.assertNotIn("cdn.jsdelivr.net", html)
            self.assertNotIn('type="importmap"', html)
            self.assertIn("Send to Orca", html)
            self.assertLess(len(html.encode()), 1_800_000)


if __name__ == "__main__":
    unittest.main()
