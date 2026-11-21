// Writing files: painted 3MF, multi-part 3MF, closed parts (cut caps and pockets), binary STL.
import { zipSync, strFromU8, strToU8 } from "fflate";
import { weld, soupIndex } from "./mesh.js";
import { components } from "./graph.js";

// ---------------------------------------------------------------- writing files
export const safeName = (s) => s.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "part";
const xmlEsc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const num = (x) => String(Math.round(x * 1e5) / 1e5);
const CONTENT_TYPES = (extra = "") => strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>${extra}</Types>`);
const RELS = () => strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`);

// Bambu/Orca per-triangle paint string (TriangleSelector::serialize + FacetsAnnotation::get_triangle_as_string):
// bits: 2 bits split count (0), then state: n<3 -> 2 bits; n>=3 -> '11' + 4-bit groups of (n-3);
// nibbles are emitted most-significant-first. Filament k is state k: 1 -> "4", 2 -> "8", 3 -> "0C", 4 -> "1C".
export function paintCode(n) {
  if (n <= 0) return "";
  const bits = [0, 0];
  if (n >= 3) { bits.push(1, 1); n -= 3; while (n >= 15) { bits.push(1, 1, 1, 1); n -= 15; } for (let i = 0; i < 4; i++) bits.push((n >> i) & 1); }
  else bits.push(n & 1, (n >> 1) & 1);
  let s = "";
  for (let o = 0; o < bits.length; o += 4) {
    const v = bits[o] | (bits[o+1] << 1) | (bits[o+2] << 2) | (bits[o+3] << 3);
    s = v.toString(16).toUpperCase() + s;
  }
  return s;
}

// Painted 3MF: one mesh, each triangle painted with its filament slot. src = { pos, tri, nV, nF }, fil(face) -> slot.
// With source = the 3MF the mesh came from (same faces, same order), its files are kept and only paint is written.
export function painted3MF(name, src, fil, source = null) {
  if (source?.type === "3mf") {
    const files = { ...source.files }, texts = {}, done = new Set();
    for (const m of source.meshes) {
      const key = m.file + "#" + m.objectId; if (done.has(key)) continue; done.add(key);
      let t = texts[m.file] ?? strFromU8(files[m.file]);
      const re = new RegExp(`<object\\b[^>]*\\bid="${m.objectId}"`, "g");
      const mm = re.exec(t); if (!mm) continue;
      const start = mm.index, end = t.indexOf("</object>", start);
      let i = 0;
      const body = t.slice(start, end).replace(/<triangle\b([^>]*?)\s*\/>/g, (_, attrs) => {
        const f = m.triStart + i++;
        attrs = attrs.replace(/\s+paint_color="[^"]*"/, "");
        return `<triangle${attrs} paint_color="${paintCode(fil(f))}"/>`;
      });
      t = t.slice(0, start) + body + t.slice(end);
      texts[m.file] = t;
    }
    for (const [p, t] of Object.entries(texts)) files[p] = strToU8(t);
    return zipSync(files, { level: 6 });
  }
  const v = [], tr = [];
  for (let i = 0; i < src.nV; i++) v.push(`<vertex x="${src.pos[3*i]}" y="${src.pos[3*i+1]}" z="${src.pos[3*i+2]}"/>`);
  for (let f = 0; f < src.nF; f++) tr.push(`<triangle v1="${src.tri[3*f]}" v2="${src.tri[3*f+1]}" v3="${src.tri[3*f+2]}" paint_color="${paintCode(fil(f))}"/>`);
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Application">MeshSplitter</metadata>
 <resources>
  <object id="1" type="model" name="${safeName(name)}">
   <mesh>
    <vertices>
${v.join("\n")}
    </vertices>
    <triangles>
${tr.join("\n")}
    </triangles>
   </mesh>
  </object>
 </resources>
 <build>
  <item objectid="1"/>
 </build>
</model>`;
  return zipSync({ "[Content_Types].xml": CONTENT_TYPES(), "_rels/.rels": RELS(), "3D/3dmodel.model": strToU8(model) }, { level: 6 });
}

// One closed mesh per part: the part's faces plus a fan cap over each open boundary loop.
export function meshOf(S, inSet) {
  const tri = [], triLab = [];
  for (let f = 0; f < S.nF; f++) if (inSet(S.labels[f])) { tri.push(S.tri[3*f], S.tri[3*f+1], S.tri[3*f+2]); triLab.push(S.labels[f]); }
  if (!tri.length) return null;
  const dir = new Set();
  for (let i = 0; i < tri.length; i += 3) for (let e = 0; e < 3; e++) dir.add(tri[i+e] + "," + tri[i+(e+1)%3]);
  const nextOf = new Map(); // boundary directed edges a->b whose twin b->a is absent
  for (let i = 0; i < tri.length; i += 3) for (let e = 0; e < 3; e++) {
    const a = tri[i+e], b = tri[i+(e+1)%3];
    if (!dir.has(b + "," + a)) { if (!nextOf.has(a)) nextOf.set(a, []); nextOf.get(a).push(b); }
  }
  const verts = []; for (const v of tri) verts.push(S.pos[3*v], S.pos[3*v+1], S.pos[3*v+2]);
  const caps = [], loopList = [];
  let loops = 0;
  for (const [start] of nextOf) {
    while (nextOf.get(start)?.length) {
      const loop = []; let a = start, guard = 0;
      do {
        const lst = nextOf.get(a); if (!lst || !lst.length) break;
        const b = lst.pop(); loop.push([a, b]); a = b;
      } while (a !== start && guard++ < 1e7);
      if (loop.length < 3) continue;
      loops++; loopList.push(loop);
      let cx = 0, cy = 0, cz = 0;
      for (const [v] of loop) { cx += S.pos[3*v]; cy += S.pos[3*v+1]; cz += S.pos[3*v+2]; }
      cx /= loop.length; cy /= loop.length; cz /= loop.length;
      for (const [a2, b2] of loop) caps.push(S.pos[3*b2], S.pos[3*b2+1], S.pos[3*b2+2], S.pos[3*a2], S.pos[3*a2+1], S.pos[3*a2+2], cx, cy, cz);
    }
  }
  return { verts: verts.concat(caps), loops, loopList, triLab, nFaceVerts: verts.length };
}

// A part that is a recess (a porthole, an eye socket) closes, with a flat cap, into a negative-volume solid: the air
// in the recess. Instead it gets a skin of material behind its surface: its faces pushed POCKET_T mm (at most 30% of
// the rim's radius) into the model, joined to the rim by a wall. The neighbor's cap over that rim is the same skin,
// reversed, so the two still make up the original solid. Returns null unless part i has one boundary loop and caps
// to a negative volume, else { key: loopKey of the rim, tris: triangle soup closing part i, original coordinates }.
const POCKET_T = 1.0;
export const loopKey = (lp) => { let m = Infinity; for (const [a] of lp) m = Math.min(m, a); return `${m}|${lp.length}`; };
export function soupVolume(v) {
  let s = 0;
  for (let i = 0; i < v.length; i += 9) s += v[i] * (v[i+4] * v[i+8] - v[i+5] * v[i+7]) - v[i+1] * (v[i+3] * v[i+8] - v[i+5] * v[i+6]) + v[i+2] * (v[i+3] * v[i+7] - v[i+4] * v[i+6]);
  return s / 6;
}
export function pocketShell(S, i, m = meshOf(S, (l) => l === i)) {
  if (!m || m.loops !== 1 || soupVolume(m.verts) >= 0) return null;
  const lp = m.loopList[0], P = S.pos, G = S.G, vn = new Map();
  for (let f = 0; f < S.nF; f++) if (S.labels[f] === i) for (let c = 0; c < 3; c++) {
    const v = S.tri[3*f+c], n = vn.get(v) || [0, 0, 0];
    for (let k = 0; k < 3; k++) n[k] += G.nrm[3*f+k] * G.area[f];
    vn.set(v, n);
  }
  const C = [0, 0, 0]; for (const [a] of lp) for (let k = 0; k < 3; k++) C[k] += P[3*a+k] / lp.length;
  let r = 0; for (const [a] of lp) r += Math.hypot(P[3*a]-C[0], P[3*a+1]-C[1], P[3*a+2]-C[2]) / lp.length;
  const t = Math.min(POCKET_T, 0.3 * r), off = new Map();
  for (const [v, n] of vn) { const l = Math.hypot(...n) || 1; off.set(v, [0, 1, 2].map((k) => P[3*v+k] - t * n[k] / l)); }
  const p = (v) => [P[3*v], P[3*v+1], P[3*v+2]], o = (v) => off.get(v), out = [];
  for (const [a, b] of lp) out.push(...p(b), ...p(a), ...o(a), ...p(b), ...o(a), ...o(b)); // wall from the rim down
  for (let f = 0; f < S.nF; f++) if (S.labels[f] === i) out.push(...o(S.tri[3*f]), ...o(S.tri[3*f+2]), ...o(S.tri[3*f+1])); // the skin's back
  return { key: loopKey(lp), tris: Float32Array.from(out), t };
}
export const reverseSoup = (v) => { const r = Float32Array.from(v); for (let i = 0; i < r.length; i += 9) for (let k = 0; k < 3; k++) { const x = r[i+3+k]; r[i+3+k] = r[i+6+k]; r[i+6+k] = x; } return r; };

// Closed triangle soup of part i in its original place: its faces, a fan cap over each cut, and the recess skin
// (pocketShell) on a rim it shares with a recess part. pockets: optional Map part -> pocketShell result (a cache).
export function closedPart(S, i, pockets = new Map()) {
  const m = meshOf(S, (l) => l === i); if (!m) return null;
  const pk = (l) => { if (l <= 0) return null; if (!pockets.has(l)) pockets.set(l, pocketShell(S, l)); return pockets.get(l); };
  const tw = new Map(), nV = S.nV;
  for (let f = 0; f < S.nF; f++) for (let e = 0; e < 3; e++) tw.set(S.tri[3*f+e] * nV + S.tri[3*f+(e+1)%3], S.labels[f]);
  const parts = [Float32Array.from(m.verts.slice(0, m.nFaceVerts))];
  for (const lp of m.loopList) {
    const key = loopKey(lp), own = pk(i);
    if (own && own.key === key) { parts.push(own.tris); continue; }
    const nbs = new Map(); for (const [a, b] of lp) { const n = tw.get(b * nV + a); if (n !== undefined) nbs.set(n, (nbs.get(n) || 0) + 1); }
    const nb = [...nbs].sort((x, y) => y[1] - x[1])[0]?.[0], np = nb !== undefined ? pk(nb) : null;
    if (np && np.key === key) { parts.push(reverseSoup(np.tris)); continue; }
    const fan = []; let cx = 0, cy = 0, cz = 0;
    for (const [v] of lp) { cx += S.pos[3*v]; cy += S.pos[3*v+1]; cz += S.pos[3*v+2]; }
    cx /= lp.length; cy /= lp.length; cz /= lp.length;
    for (const [a, b] of lp) fan.push(S.pos[3*b], S.pos[3*b+1], S.pos[3*b+2], S.pos[3*a], S.pos[3*a+1], S.pos[3*a+2], cx, cy, cz);
    parts.push(Float32Array.from(fan));
  }
  const out = new Float32Array(parts.reduce((n, a) => n + a.length, 0)); let o = 0;
  for (const a of parts) { out.set(a, o); o += a.length; }
  return out;
}

export function stlBinary(v) {
  const n = v.length / 9, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let t = 0; t < n; t++) {
    const p = v.slice(9*t, 9*t+9);
    const ux = p[3]-p[0], uy = p[4]-p[1], uz = p[5]-p[2], wx = p[6]-p[0], wy = p[7]-p[1], wz = p[8]-p[2];
    let nx = uy*wz - uz*wy, ny = uz*wx - ux*wz, nz = ux*wy - uy*wx; const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx/l, true); dv.setFloat32(o+4, ny/l, true); dv.setFloat32(o+8, nz/l, true); o += 12;
    for (let k = 0; k < 9; k++) { dv.setFloat32(o, p[k], true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return new Uint8Array(buf);
}

// One object whose parts are the split parts, each with its filament slot. parts: [{ name, filament, soup }]
// (closed triangle soups). Plain 3MF components + Metadata/model_settings.config: OrcaSlicer/Bambu Studio load
// every component as a part (volume) of the object and read each part's name and extruder from the config.
// Returns { out: zip bytes, parts: the parts written }.
export function parts3MF(name, soups) {
  const parts = soups.map((p) => {
    const w = weld(p.soup, soupIndex(p.soup));
    return { name: p.name, filament: p.filament, pos: w.pos, tri: w.tri };
  });
  if (!parts.length) throw new Error("No parts to export.");
  const objs = [], comps = [], cfg = [], kept = [], parent = parts.length + 1;
  parts.forEach((p, k) => {
    const id = k + 1, v = [], t = [];
    for (let i = 0; i < p.pos.length; i += 3) v.push(`<vertex x="${num(p.pos[i])}" y="${num(p.pos[i+1])}" z="${num(p.pos[i+2])}"/>`);
    for (let i = 0; i < p.tri.length; i += 3) if (p.tri[i] !== p.tri[i+1] && p.tri[i+1] !== p.tri[i+2] && p.tri[i] !== p.tri[i+2])
      t.push(`<triangle v1="${p.tri[i]}" v2="${p.tri[i+1]}" v3="${p.tri[i+2]}"/>`);
    if (!t.length) return; // OrcaSlicer rejects the whole file if any part has no triangles
    objs.push(`  <object id="${id}" type="model" name="${xmlEsc(p.name)}">\n   <mesh>\n    <vertices>\n${v.join("\n")}\n    </vertices>\n    <triangles>\n${t.join("\n")}\n    </triangles>\n   </mesh>\n  </object>`);
    kept.push(p);
    comps.push(`    <component objectid="${id}"/>`);
    cfg.push(`    <part id="${id}" subtype="normal_part">\n      <metadata key="name" value="${xmlEsc(p.name)}"/>\n      <metadata key="extruder" value="${p.filament}"/>\n    </part>`);
  });
  if (!kept.length) throw new Error("No parts with printable triangles to export.");
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Application">MeshSplitter</metadata>
 <resources>
${objs.join("\n")}
  <object id="${parent}" type="model" name="${xmlEsc(name)}">
   <components>
${comps.join("\n")}
   </components>
  </object>
 </resources>
 <build>
  <item objectid="${parent}"/>
 </build>
</model>`;
  const config = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="${parent}">
    <metadata key="name" value="${xmlEsc(name)}"/>
    <metadata key="extruder" value="${kept[0].filament}"/>
${cfg.join("\n")}
  </object>
</config>`;
  const out = zipSync({
    "[Content_Types].xml": CONTENT_TYPES('<Default Extension="config" ContentType="text/xml"/>'),
    "_rels/.rels": RELS(),
    "3D/3dmodel.model": strToU8(model),
    "Metadata/model_settings.config": strToU8(config),
  }, { level: 6 });
  return { out, parts: kept };
}
