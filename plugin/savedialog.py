# Copyright (c) 2026 Darin Carrigg. MIT License: see LICENSE. Official releases: https://github.com/d-carrigg/mesh-splitter
"""Windows' own Save As dialog, for the page's file exports.

OrcaSlicer 2.5's plugin API has no file dialog (orca.host.ui has message, windows and notifications only), so on
Windows the plugin shows the system one itself (comdlg32 GetSaveFileNameW), owned by OrcaSlicer's main window. It
only returns the path the user picked: the plugin then writes the file with open(), which OrcaSlicer checks as
usual (a folder outside Downloads gets OrcaSlicer's own permission prompt). Elsewhere there is no dialog and the
plugin saves to Downloads.
"""
import os
import sys


def supported():
    return os.name == "nt"


def downloads_folder():
    """The user's Downloads folder as Windows knows it (it may have been moved, e.g. to another drive), else None."""
    if os.name != "nt":
        return None
    try:
        import ctypes
        from ctypes import wintypes

        class GUID(ctypes.Structure):
            _fields_ = [("Data1", wintypes.DWORD), ("Data2", wintypes.WORD), ("Data3", wintypes.WORD),
                        ("Data4", ctypes.c_ubyte * 8)]
        # FOLDERID_Downloads {374DE290-123F-4565-9164-39C4925E467B}
        fid = GUID(0x374DE290, 0x123F, 0x4565, (ctypes.c_ubyte * 8)(0x91, 0x64, 0x39, 0xC4, 0x92, 0x5E, 0x46, 0x7B))
        out = ctypes.c_wchar_p()
        shell32, ole32 = ctypes.windll.shell32, ctypes.windll.ole32
        shell32.SHGetKnownFolderPath.argtypes = [ctypes.POINTER(GUID), wintypes.DWORD, wintypes.HANDLE,
                                                 ctypes.POINTER(ctypes.c_wchar_p)]
        if shell32.SHGetKnownFolderPath(ctypes.byref(fid), 0, None, ctypes.byref(out)) != 0:
            return None
        try:
            return out.value or None
        finally:
            ole32.CoTaskMemFree(out)
    except Exception:
        return None


FILTERS = {".stl": "STL file", ".3mf": "3MF file", ".zip": "ZIP archive", ".json": "Mesh Splitter session"}


def filter_string(name):
    """'STL file (*.stl)\\0*.stl\\0All files (*.*)\\0*.*\\0' for the file's extension."""
    ext = os.path.splitext(name)[1].lower()
    first = f"{FILTERS.get(ext, ext[1:].upper() + ' file')} (*{ext})\0*{ext}\0" if ext else ""
    return first + "All files (*.*)\0*.*\0"


def ask(name, folder, owner=None):
    """Show Save As for `name` in `folder`. Returns the chosen path, or None if the user cancelled."""
    import ctypes
    from ctypes import wintypes

    class OPENFILENAMEW(ctypes.Structure):
        _fields_ = [("lStructSize", wintypes.DWORD), ("hwndOwner", wintypes.HWND), ("hInstance", wintypes.HINSTANCE),
                    ("lpstrFilter", wintypes.LPCWSTR), ("lpstrCustomFilter", wintypes.LPWSTR),
                    ("nMaxCustFilter", wintypes.DWORD), ("nFilterIndex", wintypes.DWORD),
                    ("lpstrFile", wintypes.LPWSTR), ("nMaxFile", wintypes.DWORD), ("lpstrFileTitle", wintypes.LPWSTR),
                    ("nMaxFileTitle", wintypes.DWORD), ("lpstrInitialDir", wintypes.LPCWSTR),
                    ("lpstrTitle", wintypes.LPCWSTR), ("Flags", wintypes.DWORD), ("nFileOffset", wintypes.WORD),
                    ("nFileExtension", wintypes.WORD), ("lpstrDefExt", wintypes.LPCWSTR), ("lCustData", wintypes.LPARAM),
                    ("lpfnHook", ctypes.c_void_p), ("lpTemplateName", wintypes.LPCWSTR), ("pvReserved", ctypes.c_void_p),
                    ("dwReserved", wintypes.DWORD), ("FlagsEx", wintypes.DWORD)]

    path_buf = ctypes.create_unicode_buffer(name, 1024)
    ftext = filter_string(name) + "\0"  # a list of null-terminated strings, ended by an empty one
    filt = (ctypes.c_wchar * len(ftext))(*ftext)
    ext = os.path.splitext(name)[1].lstrip(".")
    ofn = OPENFILENAMEW()
    ofn.lStructSize = ctypes.sizeof(OPENFILENAMEW)
    ofn.hwndOwner = owner
    ofn.lpstrFilter = ctypes.cast(filt, wintypes.LPCWSTR)
    ofn.nFilterIndex = 1
    ofn.lpstrFile = ctypes.cast(path_buf, wintypes.LPWSTR)
    ofn.nMaxFile = 1024
    ofn.lpstrInitialDir = folder if folder and os.path.isdir(folder) else None
    ofn.lpstrTitle = "Save from Mesh Splitter"
    ofn.lpstrDefExt = ext or None
    # OFN_OVERWRITEPROMPT | OFN_HIDEREADONLY | OFN_NOCHANGEDIR | OFN_PATHMUSTEXIST | OFN_EXPLORER
    ofn.Flags = 0x2 | 0x4 | 0x8 | 0x800 | 0x80000
    comdlg32 = ctypes.windll.comdlg32
    comdlg32.GetSaveFileNameW.argtypes = [ctypes.POINTER(OPENFILENAMEW)]
    if comdlg32.GetSaveFileNameW(ctypes.byref(ofn)):
        return path_buf.value
    err = comdlg32.CommDlgExtendedError()
    if err:  # not a cancel: say so instead of acting as if the user closed it
        raise RuntimeError(f"Windows could not show the Save dialog (error {err:#x})")
    return None


if __name__ == "__main__" and len(sys.argv) > 1:  # manual check on Windows: python savedialog.py name.stl
    print(ask(sys.argv[1], downloads_folder()))
