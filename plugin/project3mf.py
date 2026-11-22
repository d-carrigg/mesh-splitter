# Copyright (c) 2026 Darin Carrigg. MIT License: see LICENSE. Official releases: https://github.com/d-carrigg/mesh-splitter
"""Put a Mesh Splitter result into the open OrcaSlicer project: add it, replace an object or a plate, or fill a plate.

OrcaSlicer 2.5's plugin API can read the plate but cannot add, remove or replace objects. It can write the whole
project to a 3MF (Plater.export_3mf_copy), and the running OrcaSlicer opens 3MFs handed to it the way a second
launch would (handoff.py). So the plugin edits that project copy here, in plain Python with no OrcaSlicer calls:

  add             the split goes next to the source object (or in the middle of plate 1)
  replace_object  the source object goes, the split takes its place (same plate, same position)
  replace_plate   every object on the source's plate goes, the split takes the source's place
  fill_plate      every object on the source's plate goes, the plate is filled with copies of the split

apply() returns the edited project, with everything else kept as OrcaSlicer wrote it (other objects and plates,
settings, paint), and OrcaSlicer opens it as the project. Positions only survive that way: OrcaSlicer moves a 3MF
it imports as geometry to the middle of the bed. When the split uses filament slots the project doesn't have,
the project's filament list grows to match (ensure_filaments).

The split comes in as the page's multi-part 3MF (parts3MF in app/export.js): one mesh object per part, in plate
coordinates, and Metadata/model_settings.config with each part's name and filament slot.
"""
import io
import json
import math
import re
import xml.etree.ElementTree as ET
import zipfile

CORE = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
PROD = "http://schemas.microsoft.com/3dmanufacturing/production/2015/06"
RELS = "http://schemas.openxmlformats.org/package/2006/relationships"
MODEL_REL = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"
MAIN = "3D/3dmodel.model"
CONFIG = "Metadata/model_settings.config"
MODEL_RELS = "3D/_rels/3dmodel.model.rels"
PLATE_GAP = 1 / 5  # OrcaSlicer's LOGICAL_PART_PLATE_GAP: plates sit 1.2 bed widths apart
SPACING = 6.0  # mm between copies when filling a plate

FLUSH_DEFAULT = 280.0
MODES = ("add", "replace_object", "replace_plate", "fill_plate")
# Colors for filament slots the project doesn't have yet when the page sends none (app/parts.js PALETTE)
PALETTE = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#42d4f4", "#f032e6", "#bfef45",
           "#fabed4", "#469990", "#dcbeff", "#9a6324", "#fffac8", "#800000", "#aaffc3", "#000075"]
# The per-filament settings in an OrcaSlicer 2.5 project_settings.config (one value per filament slot)
PER_FILAMENT = {
    "activate_chamber_temp_control", "additional_fan_full_speed_layer", "chamber_minimal_temperature",
    "chamber_temperature", "close_additional_fan_first_x_layers", "close_fan_the_first_x_layers", "cool_plate_temp",
    "cool_plate_temp_initial_layer", "default_filament_colour", "dont_slow_down_outer_wall",
    "enable_overhang_bridge_fan", "eng_plate_temp", "eng_plate_temp_initial_layer", "fan_cooling_layer_time",
    "filament_adhesiveness_category", "filament_change_extrusion_role_gcode", "filament_change_length",
    "filament_change_length_nc", "filament_colour", "filament_colour_type", "filament_cooling_final_speed",
    "filament_cooling_initial_speed", "filament_cooling_moves", "filament_cost", "filament_density",
    "filament_dev_ams_drying_ams_limitations", "filament_dev_ams_drying_heat_distortion_temperature",
    "filament_dev_ams_drying_temperature", "filament_dev_ams_drying_time",
    "filament_dev_chamber_drying_bed_temperature", "filament_dev_chamber_drying_time",
    "filament_dev_drying_cooling_temperature", "filament_dev_drying_softening_temperature", "filament_diameter",
    "filament_end_gcode", "filament_extruder_compatibility", "filament_flush_temp_fast", "filament_ids",
    "filament_is_mixed", "filament_is_support", "filament_loading_speed", "filament_loading_speed_start",
    "filament_map", "filament_mixed_components", "filament_mixed_gradient", "filament_mixed_gradient_curve",
    "filament_mixed_gradient_per_part", "filament_mixed_gradient_range", "filament_mixed_sublayer_ratios",
    "filament_multi_colour", "filament_notes", "filament_nozzle_map", "filament_prime_volume",
    "filament_prime_volume_nc", "filament_printable", "filament_ramming_parameters", "filament_settings_id",
    "filament_shrink", "filament_shrinkage_compensation_z", "filament_soluble", "filament_stamping_distance",
    "filament_stamping_loading_speed", "filament_start_gcode", "filament_toolchange_delay",
    "filament_tower_interface_pre_extrusion_dist", "filament_tower_interface_pre_extrusion_length",
    "filament_tower_interface_print_temp", "filament_tower_interface_purge_volume", "filament_tower_ironing_area",
    "filament_type", "filament_unloading_speed", "filament_unloading_speed_start", "filament_vendor",
    "filament_volume_map", "first_x_layer_fan_speed", "full_fan_speed_layer", "hot_plate_temp",
    "hot_plate_temp_initial_layer", "idle_temperature", "initial_layer_fan_speed", "internal_bridge_fan_speed",
    "ironing_fan_speed", "overhang_fan_speed", "overhang_fan_threshold", "pellet_flow_coefficient",
    "reduce_fan_stop_start_freq", "required_nozzle_HRC", "slow_down_for_layer_cooling", "slow_down_layer_time",
    "slow_down_min_speed", "small_area_infill_flow_compensation_model", "supertack_plate_temp",
    "supertack_plate_temp_initial_layer", "support_material_interface_fan_speed", "temperature_vitrification",
    "textured_cool_plate_temp", "textured_cool_plate_temp_initial_layer", "textured_plate_temp",
    "textured_plate_temp_initial_layer", "wiping_volumes_extruders",
}

ET.register_namespace("", CORE)
ET.register_namespace("p", PROD)
ET.register_namespace("BambuStudio", "http://schemas.bambulab.com/package/2021")


def q(tag, ns=CORE):
    return f"{{{ns}}}{tag}"


def meta(el, key):
    for m in el.findall("metadata"):
        if m.get("key") == key:
            return m.get("value")
    return None


def fmt(x):
    return f"{x:.6f}".rstrip("0").rstrip(".") if x != int(x) else str(int(x))


# ---------------------------------------------------------------- the split (the page's multi-part 3MF)

def read_split(data):
    """[(name, extruder, vertices [(x,y,z)], triangles [(a,b,c) or (a,b,c,paint_color)])] from the page's 3MF: the
    multi-part 3MF (one mesh object per part) or the painted 3MF (one mesh, OrcaSlicer paint_color per triangle)."""
    z = zipfile.ZipFile(io.BytesIO(data))
    root = ET.fromstring(z.read(MAIN))
    cfg = ET.fromstring(z.read(CONFIG)) if CONFIG in z.namelist() else ET.Element("config")
    info = {}
    for obj in cfg.findall("object"):
        for p in obj.findall("part"):
            info[p.get("id")] = (meta(p, "name"), int(meta(p, "extruder") or meta(obj, "extruder") or 1))
    parts = []
    for o in root.find(q("resources")).findall(q("object")):
        mesh = o.find(q("mesh"))
        if mesh is None:
            continue
        v = [(float(e.get("x")), float(e.get("y")), float(e.get("z"))) for e in mesh.find(q("vertices"))]
        t = [(int(e.get("v1")), int(e.get("v2")), int(e.get("v3"))) + ((e.get("paint_color"),) if e.get("paint_color") else ())
             for e in mesh.find(q("triangles"))]
        name, ext = info.get(o.get("id"), (o.get("name"), 1))
        parts.append((name or o.get("name") or f"Part {len(parts) + 1}", ext, v, t))
    if not parts:
        raise ValueError("The split has no parts")
    return parts


def paint_state(code):
    """The filament slot in an OrcaSlicer paint_color code of an unsplit triangle (TriangleSelector's bit stream,
    the inverse of paintCode in app/export.js). 0 means the part's own filament. Split triangles count as 0."""
    bits = []
    for ch in reversed(code or ""):
        v = int(ch, 16)
        bits += [(v >> i) & 1 for i in range(4)]
    if len(bits) < 4 or bits[0] or bits[1]:
        return 0
    n = bits[2] | bits[3] << 1
    if n < 3:
        return n
    n, i = 3, 4
    while i + 4 <= len(bits):
        k = bits[i] | bits[i + 1] << 1 | bits[i + 2] << 2 | bits[i + 3] << 3
        n += k
        i += 4
        if k != 15:
            break
    return n


def bounds(parts):
    lo = [min(p[2][i][k] for p in parts for i in range(len(p[2]))) for k in range(3)]
    hi = [max(p[2][i][k] for p in parts for i in range(len(p[2]))) for k in range(3)]
    return lo, hi


# ---------------------------------------------------------------- the project copy

class Project:
    def __init__(self, data):
        self.zin = zipfile.ZipFile(io.BytesIO(data))
        self.files = {n: self.zin.read(n) for n in self.zin.namelist()}
        self.root = ET.fromstring(self.files[MAIN])
        self.cfg = ET.fromstring(self.files[CONFIG]) if CONFIG in self.files else ET.Element("config")
        self.rels = ET.fromstring(self.files[MODEL_RELS]) if MODEL_RELS in self.files else ET.Element(q("Relationships", RELS))
        self.resources = self.root.find(q("resources"))
        self.build = self.root.find(q("build"))
        self.settings = {}
        if "Metadata/project_settings.config" in self.files:
            try:
                self.settings = json.loads(self.files["Metadata/project_settings.config"])
            except ValueError:
                pass

    # -- objects, in OrcaSlicer's model order (the order of their first build item)
    def object_ids(self):
        seen = []
        for it in self.build.findall(q("item")):
            if it.get("objectid") not in seen:
                seen.append(it.get("objectid"))
        return seen

    def plates(self):
        return self.cfg.findall("plate")

    def plate_of(self, oid):
        for i, pl in enumerate(self.plates()):
            for mi in pl.findall("model_instance"):
                if meta(mi, "object_id") == oid:
                    return i
        return 0

    def objects_on_plate(self, plate):
        pl = self.plates()[plate] if plate < len(self.plates()) else None
        if pl is None:
            return list(self.object_ids())
        return list(dict.fromkeys(meta(mi, "object_id") for mi in pl.findall("model_instance")))

    def resolve(self, index, oid=None, name=None):
        """The 3MF object id of OrcaSlicer's model object `index` (cross-checked by name when given)."""
        ids = self.object_ids()
        if not 0 <= index < len(ids):
            raise ValueError("The source object is no longer in the project")
        got = ids[index]
        if name:
            o = self.cfg.find(f"object[@id='{got}']")
            if o is not None and meta(o, "name") not in (None, name):
                raise ValueError(f"The project changed: object {index + 1} is '{meta(o, 'name')}', not '{name}'")
        return got

    def filament_of(self, oid):
        """The object's filament slot (its own, else its first part's), 1 if it has none."""
        o = self.cfg.find(f"object[@id='{oid}']")
        if o is None:
            return 1
        ext = meta(o, "extruder") or next((meta(p, "extruder") for p in o.findall("part") if meta(p, "extruder")), None)
        return int(ext) if ext and ext.isdigit() and int(ext) > 0 else 1

    def remove_object(self, oid):
        """Drop an object everywhere OrcaSlicer lists it: resource, build items, settings, plates, assembly."""
        for o in list(self.resources.findall(q("object"))):
            if o.get("id") == oid:
                paths = {c.get(q("path", PROD)) for c in o.iter(q("component"))}
                self.resources.remove(o)
                for p in paths - {None}:
                    still = any(c.get(q("path", PROD)) == p for c in self.resources.iter(q("component")))
                    if not still:
                        self.files.pop(p.lstrip("/"), None)
                        for r in list(self.rels):
                            if r.get("Target") == p:
                                self.rels.remove(r)
        for it in list(self.build.findall(q("item"))):
            if it.get("objectid") == oid:
                self.build.remove(it)
        for o in list(self.cfg.findall("object")):
            if o.get("id") == oid:
                self.cfg.remove(o)
        for pl in self.plates():
            for mi in list(pl.findall("model_instance")):
                if meta(mi, "object_id") == oid:
                    pl.remove(mi)
        for asm in self.cfg.findall("assemble"):
            for a in list(asm.findall("assemble_item")):
                if a.get("object_id") == oid:
                    asm.remove(a)

    # -- adding the split
    def max_id(self):
        ids = [int(o.get("id")) for o in self.resources.findall(q("object"))]
        for path in [n for n in self.files if n.startswith("3D/Objects/") and n.endswith(".model")]:
            ids += [int(x) for x in re.findall(rb'<object id="(\d+)"', self.files[path])]
        for pl in self.plates():
            ids += [int(meta(mi, "identify_id") or 0) for mi in pl.findall("model_instance")]
        return max(ids or [0])

    def add_object(self, parts, name, positions, plate):
        """Add the split as one object per position (x, y, z of its bounding box's bottom center), the way
        OrcaSlicer writes objects: meshes in 3D/Objects/<name>_<id>.model, a parent with components in the main
        model, a build item, names and filaments in model_settings.config, and a place on `plate`."""
        lo, hi = bounds(parts)
        origin = ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2])
        pl = self.plates()[plate] if plate < len(self.plates()) else None
        next_id = self.max_id() + 1
        file_stem = re.sub(r"[^A-Za-z0-9_.-]+", "_", name) or "split"
        for pos in positions:
            first, parent = next_id, next_id + len(parts)
            next_id = parent + 2
            path = f"/3D/Objects/{file_stem}_{parent}.model"
            sub = io.StringIO()
            sub.write(f'<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="{CORE}">\n <resources>\n')
            for k, (pname, ext, V, T) in enumerate(parts):
                sub.write(f'  <object id="{first + k}" type="model"><mesh><vertices>\n')
                sub.write("".join(f'<vertex x="{fmt(x - origin[0])}" y="{fmt(y - origin[1])}" z="{fmt(z - origin[2])}"/>\n' for x, y, z in V))
                sub.write("</vertices><triangles>\n")
                sub.write("".join(f'<triangle v1="{t[0]}" v2="{t[1]}" v3="{t[2]}"'
                                  + (f' paint_color="{t[3]}"' if len(t) > 3 else "") + '/>\n' for t in T))
                sub.write("</triangles></mesh></object>\n")
            sub.write(" </resources>\n <build/>\n</model>\n")
            self.files[path.lstrip("/")] = sub.getvalue().encode("utf-8")
            obj = ET.SubElement(self.resources, q("object"), {"id": str(parent), "type": "model"})
            comps = ET.SubElement(obj, q("components"))
            for k in range(len(parts)):
                ET.SubElement(comps, q("component"), {q("path", PROD): path, "objectid": str(first + k),
                                                      "transform": "1 0 0 0 1 0 0 0 1 0 0 0"})
            x, y, z = pos
            ET.SubElement(self.build, q("item"), {"objectid": str(parent), "printable": "1",
                                                  "transform": f"1 0 0 0 1 0 0 0 1 {fmt(x)} {fmt(y)} {fmt(z)}"})
            ET.SubElement(self.rels, q("Relationship", RELS), {"Target": path, "Id": f"rel-{parent}", "Type": MODEL_REL})
            o = ET.SubElement(self.cfg, "object", {"id": str(parent)})
            ET.SubElement(o, "metadata", {"key": "name", "value": name})
            ET.SubElement(o, "metadata", {"key": "extruder", "value": str(parts[0][1])})
            for k, (pname, ext, V, T) in enumerate(parts):
                p_ = ET.SubElement(o, "part", {"id": str(first + k), "subtype": "normal_part"})
                ET.SubElement(p_, "metadata", {"key": "name", "value": pname})
                ET.SubElement(p_, "metadata", {"key": "matrix", "value": "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"})
                ET.SubElement(p_, "metadata", {"key": "extruder", "value": str(ext)})
            if pl is not None:
                mi = ET.Element("model_instance")
                for k, v in (("object_id", parent), ("instance_id", 0), ("identify_id", parent + 1)):
                    ET.SubElement(mi, "metadata", {"key": k, "value": str(v)})
                pl.append(mi)
        self.config_order()

    def config_order(self):
        """OrcaSlicer reads objects before plates: keep <object>s first, then <plate>s, then <assemble>."""
        kids = list(self.cfg)
        for el in kids:
            self.cfg.remove(el)
        rank = {"object": 0, "plate": 1}
        for el in sorted(kids, key=lambda e: rank.get(e.tag, 2)):
            self.cfg.append(el)

    def ensure_filaments(self, count, colors=None):
        """Grow the project's filament list to `count` slots, so the split's parts keep their filaments. Each
        per-filament setting gets a copy of the last filament's value for the new slots; the flush volumes get
        the largest existing value (FLUSH_DEFAULT when there is none)."""
        st, colors = self.settings, colors or {}
        n = len(st.get("filament_settings_id") or [])
        if not n or count <= n:
            return 0
        for k, v in list(st.items()):
            if k == "flush_volumes_matrix" and isinstance(v, list) and len(v) == n * n:
                # 280 mm3 is what OrcaSlicer 2.5 fills in for the filaments it adds when importing geometry
                big = max((float(x) for x in v), default=0) or FLUSH_DEFAULT
                st[k] = [v[i * n + j] if i < n and j < n else ("0" if i == j else fmt(big))
                         for i in range(count) for j in range(count)]
            elif k == "flush_volumes_vector" and isinstance(v, list) and len(v) == 2 * n:
                st[k] = v + v[-2:] * (count - n)
            elif isinstance(v, list) and len(v) == n and k in PER_FILAMENT:
                st[k] = v + [v[-1]] * (count - n)
        st["filament_colour"] = st["filament_colour"][:n] + [colors.get(i + 1) or colors.get(str(i + 1)) or
                                                             PALETTE[i % len(PALETTE)] for i in range(n, count)]
        self.files["Metadata/project_settings.config"] = json.dumps(st, indent=4).encode("utf-8")
        return count - n

    # -- the bed
    def bed(self):
        """(min_x, min_y, width, depth) of the printable area, from the project's printer settings."""
        area = self.settings.get("printable_area") or ["0x0", "256x0", "256x256", "0x256"]
        pts = [tuple(float(c) for c in s.split("x")) for s in area]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)

    def excluded(self):
        """Bounding boxes of the printer's excluded bed areas (bed_exclude_area, e.g. the X1's purge corner)."""
        pts = [tuple(float(c) for c in p.split("x")) for p in self.settings.get("bed_exclude_area") or [] if "x" in p]
        if len(pts) < 3:
            return []
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        return [(min(xs), min(ys), max(xs), max(ys))]

    def plate_origin(self, plate):
        """Where OrcaSlicer puts plate `plate` (0-based): PartPlateList::compute_shape_position."""
        n = max(1, len(self.plates()))
        root = math.sqrt(n)
        cols = int(round(root)) + (1 if root > round(root) else 0)
        _, _, w, d = self.bed()
        return (plate % cols) * w * (1 + PLATE_GAP), -(plate // cols) * d * (1 + PLATE_GAP)

    def save(self):
        self.files[MAIN] = b'<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(self.root, encoding="utf-8").split(b"?>", 1)[-1].lstrip()
        self.files[CONFIG] = b'<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(self.cfg, encoding="utf-8").split(b"?>", 1)[-1].lstrip()
        rels = "".join(f' <Relationship Target="{r.get("Target")}" Id="{r.get("Id")}" Type="{r.get("Type")}"/>\n' for r in self.rels)
        self.files[MODEL_RELS] = (f'<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="{RELS}">\n{rels}</Relationships>\n').encode("utf-8")
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            order = ["[Content_Types].xml", "_rels/.rels"]
            for n in order + [n for n in self.files if n not in order]:
                if n in self.files:
                    z.writestr(n, self.files[n])
        return out.getvalue()


# ---------------------------------------------------------------- the three edits

def fill_offsets(parts, bed, origin, exclude=()):
    """Offsets that tile copies of the split over the plate, in rows, centered, SPACING apart, skipping spots that
    touch the bed's excluded areas (exclude: [(min_x, min_y, max_x, max_y)] in bed coordinates)."""
    lo, hi = bounds(parts)
    w, d = hi[0] - lo[0], hi[1] - lo[1]
    bx, by, bw, bd = bed
    nx = max(1, int((bw + SPACING) // (w + SPACING)))
    ny = max(1, int((bd + SPACING) // (d + SPACING)))
    gw, gd = nx * w + (nx - 1) * SPACING, ny * d + (ny - 1) * SPACING
    x0 = origin[0] + bx + (bw - gw) / 2 + w / 2
    y0 = origin[1] + by + (bd - gd) / 2 + d / 2
    cx, cy = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2
    out = []
    for j in range(ny):
        for i in range(nx):
            x, y = x0 + i * (w + SPACING) - origin[0], y0 + j * (d + SPACING) - origin[1]  # center, bed coordinates
            if not any(x - w / 2 < ex1 and x + w / 2 > ex0 and y - d / 2 < ey1 and y + d / 2 > ey0
                       for ex0, ey0, ex1, ey1 in exclude):
                out.append((x + origin[0] - cx, y + origin[1] - cy, 0.0))
    return out


def beside(parts, here, bed, origin, gap=10.0):
    """Where to add the split next to the original (bottom center): to its right, left, back or front, whichever
    is first to fit on the plate; to its right if none does."""
    lo, hi = bounds(parts)
    w, d = hi[0] - lo[0], hi[1] - lo[1]
    bx, by, bw, bd = bed
    x0, y0 = origin[0] + bx, origin[1] + by
    spots = [(here[0] + w + gap, here[1]), (here[0] - w - gap, here[1]), (here[0], here[1] + d + gap), (here[0], here[1] - d - gap)]
    for x, y in spots:
        if x0 <= x - w / 2 and x + w / 2 <= x0 + bw and y0 <= y - d / 2 and y + d / 2 <= y0 + bd:
            return (x, y, here[2])
    return (*spots[0], here[2])


def apply(project_data, split_data, mode, index=None, name=None, object_name=None, colors=None, single=False):
    """Returns (the project with the split in it, summary). index: OrcaSlicer's model index of the object the split
    came from (None for add, when the model didn't come from the plate). colors: {filament slot: "#rrggbb"} for
    slots the project doesn't have yet. single: the split is one part (the edited model, not for multi-color
    printing), and it goes on the source object's filament instead of the slot in the split."""
    if mode not in MODES:
        raise ValueError(f"Unknown mode {mode}")
    proj = Project(project_data)
    parts = read_split(split_data)
    lo, hi = bounds(parts)
    here = ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2])  # bottom center, plate coordinates
    if index is None:
        if mode != "add":
            raise ValueError("Open the model from the plate to replace it there")
        plate, gone = 0, []
        if single:
            parts = [(p[0], 1, p[2], p[3]) for p in parts]
        bx, by, bw, bd = proj.bed()
        positions = [(bx + bw / 2, by + bd / 2, 0.0)]
    else:
        src = proj.resolve(index, name=object_name)
        plate = proj.plate_of(src)
        if single:
            parts = [(p[0], proj.filament_of(src), p[2], p[3]) for p in parts]
        gone = {"add": [], "replace_object": [src]}.get(mode, None)
        if gone is None:
            gone = proj.objects_on_plate(plate)
        if mode == "fill_plate":
            positions = [(here[0] + dx, here[1] + dy, here[2]) for dx, dy, _ in
                         fill_offsets(parts, proj.bed(), proj.plate_origin(plate), proj.excluded())]
        elif mode == "add":
            positions = [beside(parts, here, proj.bed(), proj.plate_origin(plate))]
        else:
            positions = [here]
    for oid in gone:
        proj.remove_object(oid)
    used = [p[1] for p in parts] + [paint_state(t[3]) for p in parts for t in p[3] if len(t) > 3]
    added = proj.ensure_filaments(max(used), colors or {})
    first = len(proj.object_ids())
    proj.add_object(parts, name or object_name or "Split", positions, plate)
    # Where the model the page works on is once OrcaSlicer opens this project: the original after an add from the
    # plate, otherwise the split (its first copy). OrcaSlicer lists objects in build order.
    ids = proj.object_ids()
    if mode == "add" and index is not None:
        at = {"index": ids.index(src), "name": object_name}
    else:
        at = {"index": first, "name": name or object_name or "Split"}
    return proj.save(), {"removed": len(gone), "copies": len(positions), "plate": plate + 1, "parts": len(parts),
                         "filaments_added": added, "source_at": at}
