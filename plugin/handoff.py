"""Hand a file to the running OrcaSlicer, the way a second launch of OrcaSlicer does.

OrcaSlicer 2.5's plugin API has no call to add a file to the plate. But when OrcaSlicer is started a second time
with a file, the new process passes its command line to the one already running and quits, and the running one
loads the file as if it were dropped on the plate (OtherInstanceMessageHandler in OrcaSlicer's InstanceCheck.cpp).
The plugin runs inside that running OrcaSlicer, so it sends the same message itself:

  Windows  WM_COPYDATA (dwData 1, UTF-16 text) to OrcaSlicer's main window (class wxWindowNR with the
           Instance_Hash_Minor property) in this process
  Linux    the AnotherInstance method on the session bus, com.orcaslicer.OrcaSlicer.InstanceCheck.Object<hash>
  macOS    an open-documents Apple Event (`open -a` the running app); OrcaSlicer loads STL/STEP into the running
           app, but opens a 3MF in a new window, so on macOS the plugin falls back to "import with Cmd+I"

The text is the command line in OrcaSlicer's escaped form: "orca-slicer";"<path>". A 3MF that comes in this way
gets OrcaSlicer's usual question when the plate isn't empty: Open as project, or Import geometry only.
"""
import os
import re
import subprocess
import sys


# Programs the plugin runs (declared with orca.request_permissions): only dbus-send, only on Linux.
PROCESSES = ["dbus-send"] if sys.platform.startswith("linux") else []


def payload(paths):
    """Command line as OrcaSlicer's escape_strings_cstyle writes it; the first item stands for the executable."""
    def esc(s):
        return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return ";".join(esc(a) for a in ["orca-slicer", *paths])


def supported():
    return os.name == "nt" or sys.platform.startswith("linux")


def send(paths):
    """Ask the running OrcaSlicer to load `paths`. Raises RuntimeError when it can't be reached."""
    paths = [os.path.abspath(p) for p in paths]
    if os.name == "nt":
        return _send_windows(paths)
    if sys.platform.startswith("linux"):
        return _send_dbus(paths)
    raise RuntimeError("Sending to the plate is not available on this system")


def _send_windows(paths):
    import ctypes
    from ctypes import wintypes
    user32, kernel32 = ctypes.windll.user32, ctypes.windll.kernel32
    me = kernel32.GetCurrentProcessId()
    found = []
    enum_proc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.GetPropW.restype = wintypes.HANDLE
    user32.GetPropW.argtypes = [wintypes.HWND, wintypes.LPCWSTR]

    def visit(hwnd, _):
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value != me:
            return True
        cls = ctypes.create_unicode_buffer(64)
        user32.GetClassNameW(hwnd, cls, 64)
        if cls.value == "wxWindowNR" and user32.GetPropW(hwnd, "Instance_Hash_Minor"):
            found.append(hwnd)
            return False
        return True
    user32.EnumWindows(enum_proc(visit), 0)
    if not found:
        raise RuntimeError("OrcaSlicer's main window was not found")

    class COPYDATASTRUCT(ctypes.Structure):
        _fields_ = [("dwData", ctypes.c_size_t), ("cbData", wintypes.DWORD), ("lpData", ctypes.c_void_p)]
    buf = ctypes.create_unicode_buffer(payload(paths))
    data = COPYDATASTRUCT(1, ctypes.sizeof(buf), ctypes.cast(buf, ctypes.c_void_p))
    user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, ctypes.c_void_p]
    # PostMessage can't carry WM_COPYDATA; SendMessage from the UI thread to its own window runs the handler
    # right away, and OrcaSlicer only queues the load there (wxPostEvent), so this returns at once.
    user32.SendMessageW(found[0], 0x004A, 0, ctypes.byref(data))


def _send_dbus(paths):
    def run(*args):
        return subprocess.run(["dbus-send", "--session", *args], capture_output=True, text=True, timeout=10)
    names = run("--print-reply", "--dest=org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus.ListNames")
    ids = sorted(set(re.findall(r"com\.orcaslicer\.OrcaSlicer\.InstanceCheck\.Object(\d+)", names.stdout)))
    if not ids:
        raise RuntimeError("OrcaSlicer was not found on the session bus")
    # More than one OrcaSlicer: the one whose lock file sits in our data folder is this one.
    if len(ids) > 1:
        import orca  # only inside OrcaSlicer
        cache = os.path.join(os.path.dirname(os.path.dirname(orca.host.plugin.storage())), "cache")
        ids = [i for i in ids if os.path.exists(os.path.join(cache, f"{i}.lock"))] or ids[:1]
    iface = "com.orcaslicer.OrcaSlicer.InstanceCheck.Object" + ids[0]
    r = run("--type=method_call", f"--dest={iface}", "/com/orcaslicer/OrcaSlicer/InstanceCheck/Object" + ids[0],
            f"{iface}.AnotherInstance", "string:" + payload(paths))
    if r.returncode:
        raise RuntimeError(f"OrcaSlicer did not take the file: {r.stderr.strip()}")
