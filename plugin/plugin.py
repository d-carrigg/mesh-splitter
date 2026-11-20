# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy"]
#
# [tool.orcaslicer.plugin]
# name = "Mesh Splitter"
# description = "Split one solid mesh into color-coded parts (auto split, seeds, brush), move or replace parts, and send it back as a multi-part 3MF with a filament per part."
# author = "d-carrigg"
# version = "__VERSION__"
# ///
"""Mesh Splitter for OrcaSlicer 2.5 (stock build).

Built by plugin/build.py, which embeds the bundled app/index.html below. Install the built
file (dist/mesh_splitter_any.py) from Plugins > Install local plugin, then tick Activate.

  page --orca.postMessage({cmd: 'objects'})--------------> plugin: list plate objects
  page --orca.postMessage({cmd: 'mesh', index})----------> plugin: world-space mesh, base64 chunks
  page --orca.postMessage({cmd: 'save', id, name, ...})--> plugin: write the file to Downloads

OrcaSlicer 2.5's plugin API reads the model but cannot add or replace objects, so the split comes back as
a 3MF (one object, one part per split part, filament slot per part) that you import with Ctrl+I.
"""
import base64
import os
import re
import tempfile
import zlib

import orca

try:
    import numpy as np
except Exception:  # numpy is declared above; uv installs it when the plugin loads
    np = None

PAGE_Z = "__PAGE_Z__"  # zlib + base64 of the bundled page, filled in by build.py
CHUNK = 512 * 1024


def page_html():
    return zlib.decompress(base64.b64decode(PAGE_Z)).decode("utf-8")


def downloads_dir():
    return os.path.join(os.path.expanduser("~"), "Downloads")


def output_dir():
    d = downloads_dir()
    if os.path.isdir(d):
        return d
    try:  # only callable inside an audited plugin callback (not from a create_window handler)
        return orca.host.plugin.storage()
    except Exception:
        return tempfile.gettempdir()


# Plate edits that make the page's object list stale (orca.LifecycleEvent names).
PLATE_EVENTS = {"ObjectAdded", "ObjectDeleted", "ObjectChanged", "ObjectRenamed", "ObjectTransformed",
                "NewProject", "ProjectOpened", "ProjectClosed", "PlateSelected"}


def event_name(event):
    return getattr(event, "name", None) or str(event).split(".")[-1]


def filament_colors():
    """OrcaSlicer's current filament colors by slot ('#RRGGBB'), or [] if unavailable."""
    try:
        raw = orca.host.preset_bundle().full_config_value("filament_colour")
    except Exception:
        return []
    if isinstance(raw, (list, tuple)):
        vals = raw
    else:
        vals = str(raw or "").replace(",", ";").split(";")
    return [v.strip().strip('"') for v in vals if re.fullmatch(r'"?#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?"?', v.strip())]


def notify(text):
    try:
        ui = orca.host.ui
        ui.push_notification(ui.NotificationLevel.RegularNotificationLevel, text)
    except Exception:
        pass


def safe_name(name):
    name = os.path.basename(str(name or "mesh"))
    name = re.sub(r"[^\w.\- ]+", "_", name).strip(" .")
    return name or "mesh"


def list_objects(model):
    out = []
    for i, obj in enumerate(model.objects()):
        vols = obj.volumes()
        parts = [v for v in vols if v.is_model_part()]
        faces = sum(v.facets_count() for v in parts)
        out.append({"index": i, "id": int(obj.id()), "name": obj.name or f"Object {i + 1}", "parts": len(parts),
                    "faces": int(faces), "ignored": len(vols) - len(parts)})
    return out


def object_mesh(obj):
    """Model parts of instance 0 in world coordinates: (float32 N*3 positions, uint32 M*3 indices)."""
    inst = obj.instance(0)
    P, T, base = [], [], 0
    for vol in obj.volumes():
        if not vol.is_model_part():
            continue
        mesh = vol.mesh()
        V = np.asarray(mesh.vertices(), dtype=np.float64)
        F = np.asarray(mesh.triangles(), dtype=np.int64)
        if not len(V) or not len(F):
            continue
        M = np.asarray(inst.matrix(), dtype=np.float64) @ np.asarray(vol.matrix(), dtype=np.float64)
        W = (np.c_[V, np.ones(len(V))] @ M.T)[:, :3]
        if np.linalg.det(M[:3, :3]) < 0:  # mirrored: keep outward normals
            F = F[:, [0, 2, 1]]
        P.append(W.astype(np.float32))
        T.append((F + base).astype(np.uint32))
        base += len(V)
    if not P:
        raise ValueError(f"'{obj.name}' has no model parts with geometry")
    return np.concatenate(P), np.concatenate(T)


def find_object(model, msg):
    """The object the page asked for: by id (stable across plate edits), else by list position."""
    objs = model.objects()
    oid = msg.get("id")
    if oid is not None:
        for o in objs:
            if int(o.id()) == int(oid):
                return o
        raise ValueError("That object is no longer on the plate; pick it again")
    i = int(msg.get("index", -1))
    if not 0 <= i < len(objs):
        raise ValueError("That object is no longer on the plate; pick it again")
    return objs[i]


def mesh_messages(name, pos, tri, req=None):
    data = base64.b64encode(pos.astype("<f4").tobytes() + tri.astype("<u4").tobytes()).decode("ascii")
    n = max(1, -(-len(data) // CHUNK))
    for i in range(n):
        yield {"cmd": "mesh", "req": req, "name": name, "nV": int(len(pos)), "nF": int(len(tri)),
               "part": i, "of": n, "data": data[i * CHUNK:(i + 1) * CHUNK]}


def unique_path(folder, name):
    """folder/name, or 'name (2).ext' etc. so an earlier export (maybe already imported in Orca) is kept."""
    path = os.path.join(folder, name)
    stem, ext = os.path.splitext(name)
    n = 2
    while os.path.exists(path):
        path = os.path.join(folder, f"{stem} ({n}){ext}")
        n += 1
    return path


class Bridge:
    """Message handling shared by the page tab and the window. `send` posts one JSON value to the page."""

    def __init__(self, send):
        self.send = send
        self.saves = {}

    def handle(self, msg):
        if not isinstance(msg, dict):
            return
        cmd = msg.get("cmd")
        try:
            if cmd == "objects":
                self.send({"cmd": "objects", "auto": bool(msg.get("auto")), "objects": list_objects(orca.host.model()),
                           "filament_colors": filament_colors()})
            elif cmd == "mesh":
                if np is None:
                    raise RuntimeError("numpy is not installed; reload the plugin so OrcaSlicer can install it")
                obj = find_object(orca.host.model(), msg)
                pos, tri = object_mesh(obj)
                for m in mesh_messages(obj.name or "Object", pos, tri, msg.get("req")):
                    self.send(m)
            elif cmd == "save":
                self.save_chunk(msg)
        except Exception as e:  # report to the page instead of failing silently
            if cmd == "save":
                self.saves.pop(msg.get("id"), None)
                self.send({"cmd": "save_error", "id": msg.get("id"), "message": str(e)})
            else:
                self.send({"cmd": "error", "message": f"Mesh Splitter: {e}"})

    def save_chunk(self, msg):
        sid, part, of = msg["id"], int(msg["part"]), int(msg["of"])
        buf = self.saves.setdefault(sid, [None] * of)
        buf[part] = msg["data"]
        if any(x is None for x in buf):
            return
        del self.saves[sid]
        path = unique_path(output_dir(), safe_name(msg.get("name")))
        with open(path, "wb") as f:
            f.write(base64.b64decode("".join(buf)))
        self.send({"cmd": "saved", "id": sid, "path": path})
        if path.lower().endswith(".3mf"):
            notify(f"Mesh Splitter saved {os.path.basename(path)} to {os.path.dirname(path)}. Press Ctrl+I to import it.")


class MeshSplitterPage(orca.pages.PagesPluginCapabilityBase):
    def __init__(self):
        super().__init__()
        self.bridge = Bridge(self.post_message)

    def get_name(self):
        return "Mesh Splitter"

    def get_ui(self):
        return page_html()

    def get_icon(self):
        return "menu_split_parts"  # name of an OrcaSlicer resources/images icon

    def on_message(self, data):
        self.bridge.handle(data)

    def on_lifecycle_event(self, event, ctx):
        # May run on any thread: only post (the host marshals it to the UI thread); the page re-requests.
        name = event_name(event)
        if name in PLATE_EVENTS:
            self.post_message({"cmd": "plate_changed", "event": name, "id": str(getattr(ctx, "id", "") or ""),
                               "index": int(getattr(ctx, "index", -1))})


class OpenMeshSplitter(orca.script.ScriptPluginCapabilityBase):
    """Run from the Plugins dialog: opens the splitter in its own window (the tab does the same)."""

    window = None

    def get_name(self):
        return "Open Mesh Splitter window"

    def execute(self):
        w = OpenMeshSplitter.window
        if w is not None and w.is_open():
            return orca.ExecutionResult.skipped("Mesh Splitter window is already open")
        holder = {}
        bridge = Bridge(lambda m: holder["w"].post(m))
        holder["w"] = OpenMeshSplitter.window = orca.host.ui.create_window(
            html=page_html(), title="Mesh Splitter", width=1400, height=900, on_message=bridge.handle)
        return orca.ExecutionResult.success("Mesh Splitter opened")


@orca.plugin
class MeshSplitterPlugin(orca.base):
    def register_capabilities(self):
        orca.request_permissions(fs_readwrite=[os.path.join(downloads_dir(), "*")])
        orca.register_capability(MeshSplitterPage)
        orca.register_capability(OpenMeshSplitter)
