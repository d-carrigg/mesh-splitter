"""Make the two demo meshes from the curling figure files (the meshes are not in this repo).

    uv run --with trimesh --with numpy python docs/demo/prep_curling.py ORIGINAL.3mf FLIPPED.stl FLIPPED.split.json OUT_DIR

ORIGINAL.3mf is the Bambu project of the figure. FLIPPED.stl / .split.json are the eyes-flipped variant and its
saved Mesh Splitter session, where the part named "eyes" holds the new eyes. Writes OUT_DIR/curler.stl (the
original, in the variant's coordinates) and OUT_DIR/eyes_flipped.stl (only the new eyes), so Replace keeps the
eyes in place.
"""
from __future__ import annotations

import base64
import json
import re
import sys
import zipfile
import zlib
from pathlib import Path

import numpy as np
import trimesh


def load_3mf(path: Path) -> trimesh.Trimesh:
    z = zipfile.ZipFile(path)
    root = z.read("3D/3dmodel.model").decode()
    obj = next(n for n in z.namelist() if n.startswith("3D/Objects/") and n.endswith(".model"))
    t = z.read(obj).decode()
    v = np.array(re.findall(r'<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"', t), float)
    f = np.array(re.findall(r'<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"', t), int)
    m = re.search(r'<item [^>]*transform="([^"]+)"', root)
    a = np.array(m.group(1).split(), float) if m else np.r_[np.eye(3).ravel(), 0, 0, 0]
    mesh = trimesh.Trimesh(v @ a[:9].reshape(3, 3), f, process=False)
    mesh.apply_translation([0, 0, -mesh.bounds[0, 2]])  # sit on the bed, like the STL export
    return mesh


def main() -> None:
    orig, flipped, split, out = map(Path, sys.argv[1:5])
    out.mkdir(parents=True, exist_ok=True)
    o = load_3mf(orig)
    fl = trimesh.load(flipped, process=False)
    o.apply_translation(fl.bounds.mean(0) - o.bounds.mean(0))
    o.export(out / "curler.stl")
    s = json.loads(split.read_text())
    labels = np.frombuffer(zlib.decompress(base64.b64decode(s["labels"])), np.int32)
    eyes = next(i for i, p in enumerate(s["parts"]) if p["name"].lower() == "eyes")
    e = trimesh.Trimesh(fl.vertices, fl.faces[labels == eyes])
    e.remove_unreferenced_vertices()
    e.export(out / "eyes_flipped.stl")
    print(f"curler.stl {len(o.faces)} faces, eyes_flipped.stl {len(e.faces)} faces -> {out}")


if __name__ == "__main__":
    main()
