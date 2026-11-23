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
# Copyright (c) 2026 Darin Carrigg. MIT License: see LICENSE. Official releases: https://github.com/d-carrigg/mesh-splitter
"""Mesh Splitter for OrcaSlicer 2.5 (stock build).

Built by plugin/build.py into dist/mesh_splitter_any.whl, with the bundled app/index.html as page.html next to
this file. Install the wheel from Plugins > Install local plugin, then tick Activate.

  page --orca.postMessage({cmd: 'objects'})--------------> plugin: list plate objects
  page --orca.postMessage({cmd: 'mesh', index})----------> plugin: world-space mesh, base64 chunks
  page --orca.postMessage({cmd: 'save', id, name, ...})--> plugin: ask where to save it (Windows' Save As dialog;
                                                           Downloads elsewhere) and write it, or with a `mode`
                                                           hand the split to OrcaSlicer (send_to_orca below)
  page --orca.postMessage({cmd: 'llm_*', ...})-----------> plugin: AI part naming settings / one request, only when
                                                           the user clicks (llm_providers below)

Internet access: only AI part naming connects, and only when the user clicks Connect or Name parts. It sends the
part images and stats to the provider the user picked (OpenRouter, OpenAI, Anthropic, or a base URL they enter,
such as LM Studio on their own computer). OrcaSlicer asks the user's permission for that host before the first
request (ask_network_permission), and once AI naming is set up the plugin declares that one host with
orca.request_permissions at load (register_capabilities below). Nothing else in the plugin uses the network.

OrcaSlicer 2.5's plugin API reads the model but cannot add or replace objects. So Send to Orca edits a copy of the
open project (project3mf.py): it adds the split next to the original, or in its place, or fills its plate with
copies. It then hands that copy to the running OrcaSlicer the way a second launch of OrcaSlicer would (handoff.py),
and OrcaSlicer opens it as the project. Where the handoff isn't available (macOS) the project is saved to Downloads
to open with File > Open Project.
"""
import base64
import json
import os
import re
import sys
import tempfile
import threading
import time

import orca

try:
    import numpy as np
except Exception:  # numpy is declared above; uv installs it when the plugin loads
    np = None

import handoff  # noqa: E402
import project3mf  # noqa: E402
import savedialog  # noqa: E402
from llm_providers import abort as llm_abort, call as llm_call, check as llm_check, resolve as llm_resolve, status as llm_status, update as llm_update  # noqa: E402  __LLM_PROVIDERS__

CHUNK = 512 * 1024


def page_html():
    """The app page: app/index.html with three.js, three-mesh-bvh and fflate, bundled by plugin/build.py and shipped
    as page.html next to this file. Inside OrcaSlicer the page sends every request through this plugin
    (window.orca.postMessage); its fetch() calls are used only when it runs as the separate web app."""
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "page.html"), encoding="utf-8") as f:
        return f.read()


_storage = []  # the plugin's own data folder, found once from a plugin callback


def storage_dir():
    if not _storage:
        try:  # only callable inside an audited plugin callback (not from a create_window handler)
            _storage.append(orca.host.plugin.storage())
        except Exception:
            return os.path.join(os.path.expanduser("~"), ".mesh-splitter")
    return _storage[0]


def ai_settings_path():
    return os.path.join(storage_dir(), "ai_naming.json")


def load_ai_settings():
    try:
        with open(ai_settings_path(), encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def save_ai_settings(store):
    path = ai_settings_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(store, f, indent=2)


def ai_naming_host():
    """'https://openrouter.ai' for the AI naming provider the user saved, or None if AI naming isn't set up."""
    store = load_ai_settings()
    if not store.get("provider"):
        return None
    try:
        return network_origin(llm_resolve(store)["base_url"])
    except ValueError:
        return None


def network_origin(url):
    """'https://Api.Example.com:8443/v1/x' -> 'https://api.example.com', the host-wide form OrcaSlicer saves."""
    m = re.match(r"^(https?)://([^/?#]+)", str(url), re.I)
    if not m:
        raise ValueError(f"not an http(s) URL: {url}")
    host = m.group(2).rsplit("@", 1)[-1].lower()
    host = host if host.startswith("[") and host.endswith("]") else re.sub(r"(\]|^[^:\[]*):\d*$", r"\1", host)
    return f"{m.group(1).lower()}://{host}"


def ask_network_permission(url):
    """Ask OrcaSlicer's permission for the provider's host now, on the UI thread, before the worker thread sends
    the request (a prompt raised off the UI thread is denied the first time). OrcaSlicer saves a Yes for the
    whole host, so this asks once per provider. Raises if the user says No."""
    sys.audit("urllib.Request", network_origin(url), None, {}, "POST")


def permission_text(e):
    """OrcaSlicer's PermissionError says 'audit permission required': say what to do instead."""
    if isinstance(e, PermissionError) or "permission" in str(e).lower():
        return ("OrcaSlicer did not allow Mesh Splitter to connect to the provider. Try again and click Yes "
                "when OrcaSlicer asks.")
    return f"Mesh Splitter: {e}"


def last_save_dir():
    """The folder the user last saved an export to (remembered in the plugin's storage), or None."""
    try:
        with open(os.path.join(storage_dir(), "last_save_dir.txt"), encoding="utf-8") as f:
            d = f.read().strip()
        return d if os.path.isdir(d) else None
    except OSError:
        return None


def remember_save_dir(folder):
    try:
        os.makedirs(storage_dir(), exist_ok=True)
        with open(os.path.join(storage_dir(), "last_save_dir.txt"), "w", encoding="utf-8") as f:
            f.write(folder)
    except OSError:
        pass


def downloads_dir():
    """The user's Downloads folder (where Windows says it is, since it can be moved), else ~/Downloads."""
    return savedialog.downloads_folder() or os.path.join(os.path.expanduser("~"), "Downloads")


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
        painted = getattr(obj, "is_mm_painted", None)
        out.append({"index": i, "id": int(obj.id()), "name": obj.name or f"Object {i + 1}", "parts": len(parts),
                    "faces": int(faces), "ignored": len(vols) - len(parts),
                    # how the object prints now: the page starts in the matching "Print as" mode
                    "painted": bool(painted()) if painted else False,
                    "filaments": sorted({int(v.extruder_id()) for v in parts if hasattr(v, "extruder_id")})})
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


def write_new(folder, name, data):
    path = unique_path(folder, name)
    with open(path, "wb") as f:
        f.write(data)
    return path


def object_index(model, src):
    """Where the object the split came from is in the plate's object list now (it may have moved since). OrcaSlicer
    gives every object a new id when it opens a project, as it does after each Send to Orca, so when the id is gone
    the object is found by name: at the index the page last knew, else the only object with that name.
    (None, None) when it isn't on the plate any more."""
    objs = model.objects()
    for i, o in enumerate(objs):
        if src.get("id") is not None and int(o.id()) == int(src["id"]):
            return i, o.name
    name, i = src.get("name"), src.get("index")
    if name:
        if isinstance(i, int) and 0 <= i < len(objs) and objs[i].name == name:
            return i, name
        hits = [j for j, o in enumerate(objs) if o.name == name]
        if len(hits) == 1:
            return hits[0], name
    return None, None  # deleted in OrcaSlicer (or renamed): the split goes where it is (project3mf in_place)


def send_to_orca(data, msg):
    """Send to Orca: hand the page's multi-part 3MF (`data`) to OrcaSlicer. Runs on the UI thread (a page message),
    which the plater calls need. Returns the 'saved' reply: the files written and a note for the user.

      add             the split as a new object next to the original (plate 1's middle if it isn't from the plate)
      replace_object  the split takes the original's place
      replace_plate   the original's plate is cleared and the split takes the original's place
      fill_plate      the original's plate is cleared and filled with copies of the split

    msg["single"]: `data` is the edited model as one part, which goes on the original object's filament (the default;
    otherwise each part keeps its filament slot). The plugin edits a copy of the project (project3mf.py) and hands it
    to OrcaSlicer, which asks how to open it:
    'Open as project' loads it. Unsaved changes are already in that copy, so 'No' is fine when it offers to save.
    """
    mode, src = msg["mode"], msg.get("source") or {}
    folder = output_dir()
    name = re.sub(r"_parts$", "", os.path.splitext(safe_name(msg.get("name")))[0]) or "Split"
    index, src_name = object_index(orca.host.model(), src) if src else (None, None)
    plater = orca.host.plater()
    stem = os.path.splitext(os.path.basename(plater.project_path() or ""))[0] or "Untitled"
    stem = re.sub(r"( - Mesh Splitter)+( \(\d+\))?$", "", stem) or "Untitled"  # sent before: don't grow the name
    # The copy goes in the plugin's own folder, where OrcaSlicer lets the plugin read and delete without asking.
    tmp = unique_path(storage_dir(), ".mesh-splitter-project.3mf")
    try:
        plater.export_3mf_copy(tmp)
        with open(tmp, "rb") as f:
            project = f.read()
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    colors = {int(k): v for k, v in (msg.get("colors") or {}).items() if str(k).isdigit()}
    edited, info = project3mf.apply(project, data, mode, index, name=name, object_name=src_name, colors=colors,
                                    single=bool(msg.get("single")), in_place=bool(src) and index is None)
    path = write_new(folder, f"{safe_name(stem)} - Mesh Splitter.3mf", edited)
    # Where the model will be once OrcaSlicer opens the project (new ids then): the page's next send finds it there
    info["source"] = info.pop("source_at", None)
    if not handoff.supported():
        note = (f"Saved {os.path.basename(path)} to {folder}. Sending to OrcaSlicer isn't available on this system: "
                "open it with File > Open Project.")
        return {"path": path, "files": [path], "note": note}
    try:
        handoff.send([path])
    except Exception as e:  # the project is saved either way: say where, and how to open it
        note = (f"Couldn't reach OrcaSlicer ({e}). The project is saved as {os.path.basename(path)} in {folder}: "
                "open it with File > Open Project.")
        return {"path": path, "files": [path], "note": note, "warn": True, **info}
    note = ("Sent to OrcaSlicer. When it asks, pick Open as project. It already has your unsaved changes, so No is "
            f"fine when it offers to save. The project is now {os.path.basename(path)} in {folder}.")
    notify("Mesh Splitter: " + note)
    return {"path": path, "files": [path], "note": note, "ask": "Open as project", **info}


class Bridge:
    """Message handling shared by the page tab and the window. `send` posts one JSON value to the page."""

    def __init__(self, send):
        self.send = send
        self.saves = {}
        self.llm_jobs = {}  # naming request id -> body chunks received so far
        self.llm_running = {}  # naming request id -> {"cancel": Event, "resp": [open response]}

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
            elif cmd == "llm_status":
                self.send({"cmd": "llm_status", **llm_status(load_ai_settings())})
            elif cmd == "llm_settings":
                store = llm_update(load_ai_settings(), msg.get("settings"))
                save_ai_settings(store)
                self.send({"cmd": "llm_status", "saved": True, **llm_status(store)})
            elif cmd == "llm_test":
                cfg = llm_resolve(load_ai_settings())
                ask_network_permission(cfg["base_url"] + "/models")
                self.run_async(lambda: {"cmd": "llm_test", **llm_check(cfg)},
                               lambda e: {"cmd": "llm_test", "ok": False, "models": [], "error": str(e)})
            elif cmd == "llm_name":
                self.name_chunk(msg)
            elif cmd == "llm_cancel":
                self.cancel_naming(msg.get("id"))
        except Exception as e:  # report to the page instead of failing silently
            if cmd in ("llm_status", "llm_settings", "llm_test"):
                self.send({"cmd": "llm_test" if cmd == "llm_test" else "llm_status", "ok": False,
                           "error": permission_text(e), "models": []})
            elif cmd == "llm_name":
                self.llm_jobs.pop(msg.get("id"), None)
                self.llm_running.pop(msg.get("id"), None)
                self.send({"cmd": "llm_result", "id": msg.get("id"), "ok": False, "error": permission_text(e)})
            elif cmd == "save":
                self.saves.pop(msg.get("id"), None)
                self.send({"cmd": "save_error", "id": msg.get("id"), "message": str(e)})
            else:
                self.send({"cmd": "error", "message": f"Mesh Splitter: {e}"})

    def run_async(self, work, on_error, done=None):
        """Run a slow network call off the UI thread; the host marshals post_message back to it."""
        def go():
            try:
                out = work()
            except BaseException as e:  # e.g. OrcaSlicer denied the request; never leave the page waiting
                out = on_error(e)
            (done or self.send)(out)
        threading.Thread(target=go, daemon=True).start()

    def name_chunk(self, msg):
        """AI part naming: the page sends the request body (views + stats) in chunks; send it once complete."""
        jid, part, of = msg["id"], int(msg["part"]), int(msg["of"])
        buf = self.llm_jobs.setdefault(jid, [None] * of)
        buf[part] = msg["data"]
        if any(x is None for x in buf):
            return
        del self.llm_jobs[jid]
        body = json.loads("".join(buf))
        cfg = llm_resolve(load_ai_settings())
        job = self.llm_running[jid] = {"cancel": threading.Event(), "resp": []}
        self.send({"cmd": "llm_progress", "id": jid, "stage": "permission"})
        if cfg["base_url"]:
            ask_network_permission(cfg["base_url"] + ("/messages" if cfg["api"] == "anthropic" else "/chat/completions"))
        last = [0.0, ""]

        def progress(stage, info):  # every stage change, then a few times a second
            now = time.monotonic()
            if not job["cancel"].is_set() and (stage != last[1] or now - last[0] > 0.4):
                last[0], last[1] = now, stage
                self.send({"cmd": "llm_progress", "id": jid, "stage": stage, **info})

        def work():
            code, out = llm_call(cfg, body, progress=progress, cancel=job["cancel"].is_set,
                                 on_response=job["resp"].append)
            return {"cmd": "llm_result", "id": jid, **out}

        def finish(out):  # a cancelled request already answered the page
            if self.llm_running.pop(jid, None) is not None:
                self.send(out)
        self.run_async(work, lambda e: {"cmd": "llm_result", "id": jid, "ok": False, "error": f"Mesh Splitter: {e}"},
                       finish)

    def cancel_naming(self, jid):
        """Cancel: answer the page now, then stop the request (shut the socket so a blocked read returns)."""
        self.llm_jobs.pop(jid, None)
        job = self.llm_running.pop(jid, None)
        if job:
            job["cancel"].set()
            for r in job["resp"]:
                llm_abort(r)
        self.send({"cmd": "llm_result", "id": jid, "ok": False, "cancelled": True, "error": "Cancelled"})

    def save_chunk(self, msg):
        sid, part, of = msg["id"], int(msg["part"]), int(msg["of"])
        buf = self.saves.setdefault(sid, [None] * of)
        buf[part] = msg["data"]
        if any(x is None for x in buf):
            return
        del self.saves[sid]
        data = base64.b64decode("".join(buf))
        if msg.get("mode"):
            self.send({"cmd": "saved", "id": sid, **send_to_orca(data, msg)})
            return
        name = safe_name(msg.get("name"))
        path, warn = None, ""
        if savedialog.supported():
            try:
                path = savedialog.ask(name, last_save_dir() or output_dir(), handoff.main_window())
            except Exception as e:  # the dialog itself failed: still save the file, and say where
                warn = f" (the Save dialog didn't open: {e})"
            else:
                if not path:
                    self.send({"cmd": "saved", "id": sid, "cancelled": True})
                    return
        if not path:  # no system dialog here: Downloads, never overwriting an earlier export
            path = unique_path(output_dir(), name)
        with open(path, "wb") as f:
            f.write(data)
        remember_save_dir(os.path.dirname(path))
        self.send({"cmd": "saved", "id": sid, "path": path, "folder": os.path.dirname(path), **({"warn": warn} if warn else {})})
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
        storage_dir()  # remember the plugin's data folder while a plugin callback is running
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
        # OrcaSlicer prompts the user for these at load. No network or threads until AI naming is set up: before
        # that, the first Connect click asks for the host (ask_network_permission).
        storage_dir()
        ai_host = ai_naming_host()
        orca.request_permissions(
            fs_readwrite=[os.path.join(downloads_dir(), "*")],
            process=handoff.PROCESSES,
            network=[ai_host] if ai_host else [],
            threading=bool(ai_host),
        )
        orca.register_capability(MeshSplitterPage)
        orca.register_capability(OpenMeshSplitter)
