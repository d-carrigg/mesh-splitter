"""Check a Mesh Splitter multi-part 3MF the way OrcaSlicer 2.5.1's importer (bbs_3mf.cpp) reads it.

    python verify_3mf.py FILE.3mf [--parts N] [--json]

Rules checked: one build item; it references an object made only of <components>; every component points
at a mesh object in the same file; Metadata/model_settings.config has an <object> with that id and one
<part id=...> per component with a name and an extruder >= 1; every part mesh is closed (watertight).
"""
import argparse
import json
import sys
import xml.etree.ElementTree as ET
import zipfile

import numpy as np
import trimesh

NS = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}


def check(path):
    z = zipfile.ZipFile(path)
    model = ET.fromstring(z.read("3D/3dmodel.model"))
    cfg = ET.fromstring(z.read("Metadata/model_settings.config"))
    objs = {o.get("id"): o for o in model.findall("m:resources/m:object", NS)}
    items = model.findall("m:build/m:item", NS)
    assert len(items) == 1, f"expected 1 build item, got {len(items)}"
    parent = objs[items[0].get("objectid")]
    comps = parent.findall("m:components/m:component", NS)
    assert comps and parent.find("m:mesh", NS) is None, "build item must be a components-only object"
    cobj = cfg.find(f"object[@id='{parent.get('id')}']")
    assert cobj is not None, "model_settings.config has no <object> for the build item"
    cfg_parts = {p.get("id"): p for p in cobj.findall("part")}
    parts = []
    for c in comps:
        oid = c.get("objectid")
        o = objs.get(oid)
        assert o is not None and o.find("m:mesh", NS) is not None, f"component {oid} is not a mesh object"
        p = cfg_parts.get(oid)
        assert p is not None and p.get("subtype") == "normal_part", f"no normal_part config for part {oid}"
        meta = {m.get("key"): m.get("value") for m in p.findall("metadata")}
        assert meta.get("name"), f"part {oid} has no name"
        ext = int(meta.get("extruder", "0"))
        assert ext >= 1, f"part {oid} extruder {ext}"
        V = np.array([[float(v.get(k)) for k in "xyz"] for v in o.findall("m:mesh/m:vertices/m:vertex", NS)])
        F = np.array([[int(t.get(k)) for k in ("v1", "v2", "v3")] for t in o.findall("m:mesh/m:triangles/m:triangle", NS)])
        assert len(F) and F.max() < len(V), f"part {oid} has bad triangle indices"
        mesh = trimesh.Trimesh(V, F, process=True)
        parts.append({"id": int(oid), "name": meta["name"], "extruder": ext, "faces": int(len(F)),
                      "watertight": bool(mesh.is_watertight), "volume_mm3": round(float(mesh.volume), 1),
                      "bounds": np.round(mesh.bounds, 2).tolist()})
    return {"object": parent.get("name"), "parts": parts}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--parts", type=int, help="expected part count")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    r = check(a.file)
    if a.parts is not None:
        assert len(r["parts"]) == a.parts, f"expected {a.parts} parts, got {len(r['parts'])}"
    bad = [p for p in r["parts"] if not p["watertight"]]
    if a.json:
        print(json.dumps(r))
    else:
        print(f"{r['object']}: {len(r['parts'])} parts")
        for p in r["parts"]:
            print(f"  #{p['id']} {p['name']}: extruder {p['extruder']}, {p['faces']} faces, "
                  f"{'closed' if p['watertight'] else 'OPEN'}, {p['volume_mm3']} mm3")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
