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
  page --orca.postMessage({cmd: 'llm_*', ...})-----------> plugin: AI part naming settings / one request, only when
                                                           the user clicks (llm_providers below)

Internet access: only AI part naming connects, and only when the user clicks Connect or Name parts. It sends the
part images and stats to the provider the user picked (OpenRouter, OpenAI, Anthropic, or a base URL they enter,
such as LM Studio on their own computer). The plugin declares the three built-in provider hosts with
orca.request_permissions (register_capabilities below), so OrcaSlicer asks the user at install; a base URL the user
enters is asked for when first used (ask_network_permission). Nothing else in the plugin uses the network.

OrcaSlicer 2.5's plugin API reads the model but cannot add or replace objects, so the split comes back as
a 3MF (one object, one part per split part, filament slot per part) that you import with Ctrl+I.
"""
import base64
import json
import os
import re
import sys
import tempfile
import threading
import time
import zlib

import orca

try:
    import numpy as np
except Exception:  # numpy is declared above; uv installs it when the plugin loads
    np = None

from llm_providers import PROVIDERS as LLM_PROVIDERS, abort as llm_abort, call as llm_call, check as llm_check, resolve as llm_resolve, status as llm_status, update as llm_update  # noqa: E402  __LLM_PROVIDERS__

# The plugin's page: app/index.html with three.js, three-mesh-bvh and fflate, bundled and minified by esbuild,
# then zlib-compressed and base64-encoded by plugin/build.py (the plain page is about 0.9 MB). page_html()
# decodes it and OrcaSlicer shows it in the Mesh Splitter tab. Source: app/ in github.com/d-carrigg/mesh-splitter.
# To read it, rebuild the same page from source: python plugin/build.py --page-out page.html
# Inside OrcaSlicer the page sends every request through this plugin (window.orca.postMessage). Its fetch() calls
# are used only when the same page runs as the separate Mesh Splitter web app, never inside OrcaSlicer.
PAGE_Z = "__PAGE_Z__"

# The built-in AI naming providers (PROVIDERS in llm_providers): the only internet hosts the plugin connects to
# besides a custom base URL the user enters.
AI_PROVIDER_HOSTS = ("https://openrouter.ai", "https://api.openai.com", "https://api.anthropic.com")
CHUNK = 512 * 1024


def page_html():
    return zlib.decompress(base64.b64decode(PAGE_Z)).decode("utf-8")


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
        # Declared up front, so OrcaSlicer asks the user once, at install, in one prompt:
        #  - write files in ~/Downloads: Send to Orca saves the split 3MF there
        #  - connect to the AI naming providers' hosts (used only when the user clicks Connect or Name parts)
        #  - start background threads: AI naming runs its request off the UI thread
        # A custom AI base URL the user types in later is asked for by OrcaSlicer when it is first used.
        orca.request_permissions(
            fs_readwrite=[os.path.join(downloads_dir(), "*")],
            network=list(AI_PROVIDER_HOSTS),
            threading=True,
        )
        storage_dir()
        orca.register_capability(MeshSplitterPage)
        orca.register_capability(OpenMeshSplitter)
