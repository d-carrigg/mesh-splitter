// Reading meshes (STL, 3MF), welding, long-edge refinement, inside-out repair, and a new split of a loaded mesh.
import { unzipSync, strFromU8 } from "fflate";
import { buildGraph, components } from "./graph.js";
import { UNASSIGNED_COLOR, newPart } from "./parts.js";

// ---------------------------------------------------------------- reading files
// Binary or ASCII STL -> triangle soup (9 floats per triangle). Binary unless the size doesn't fit the face count
// and "solid" starts the file (within a byte-order mark), as three.js's STLLoader decides: some exporters pad binaries.
export function parseSTL(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = u8.length >= 84 ? dv.getUint32(80, true) : -1;
  const ascii = 84 + n * 50 !== u8.length && [0, 1, 2, 3, 4].some((o) => strFromU8(u8.subarray(o, o + 5)) === "solid");
  if (n >= 0 && !ascii) {
    if (84 + n * 50 > u8.length) throw new Error("Not a valid STL file (truncated)");
    const out = new Float32Array(n * 9);
    for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) out[9*t+k] = dv.getFloat32(84 + 50*t + 12 + 4*k, true);
    return out;
  }
  const txt = strFromU8(u8), out = [], re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  for (let m; (m = re.exec(txt));) out.push(+m[1], +m[2], +m[3]);
  if (!out.length || out.length % 9) throw new Error("Not a valid STL file");
  return new Float32Array(out);
}

// 3MF transform: 12 numbers, row-vector convention p' = p * M
const I12 = [1,0,0, 0,1,0, 0,0,1, 0,0,0];
function parseT(s) { if (!s) return I12.slice(); const a = s.trim().split(/\s+/).map(Number); return a.length === 12 ? a : I12.slice(); }
function mulT(A, B) { // apply A then B
  const r = new Array(12);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    let v = (i === 3 ? B[9 + j] : 0);
    for (let k = 0; k < 3; k++) v += A[i * 3 + k] * B[k * 3 + j];
    r[i * 3 + j] = v;
  }
  return r;
}
const kids = (el) => Array.prototype.filter.call(el.childNodes, (c) => c.nodeType === 1);

// parseXml(text) -> XML Document: DOMParser in the browser, @xmldom/xmldom in Node.
export function parse3MF(buf, parseXml) {
  const files = unzipSync(new Uint8Array(buf));
  const norm = (p) => p.replace(/^\//, "");
  let root = "3D/3dmodel.model";
  if (files["_rels/.rels"]) {
    const m = strFromU8(files["_rels/.rels"]).match(/Target="([^"]+\.model)"/i);
    if (m) root = norm(m[1]);
  }
  const docs = {};
  const getDoc = (p) => {
    p = norm(p);
    if (!docs[p]) {
      if (!files[p]) throw new Error("3MF part missing: " + p);
      docs[p] = parseXml(strFromU8(files[p]));
    }
    return docs[p];
  };
  const findObj = (doc, id) => { for (const o of Array.from(doc.getElementsByTagName("object"))) if (o.getAttribute("id") === String(id)) return o; return null; };
  const pos = [], tri = [], meshes = [];
  let painted = false; // any triangle with OrcaSlicer / Bambu color paint
  function addObject(file, id, M, depth) {
    if (depth > 16) return;
    const obj = findObj(getDoc(file), id);
    if (!obj) return;
    const meshEl = kids(obj).find((c) => c.localName === "mesh");
    if (meshEl) {
      const v0 = pos.length / 3, t0 = tri.length / 3;
      for (const v of Array.from(meshEl.getElementsByTagName("vertex"))) {
        const x = +v.getAttribute("x"), y = +v.getAttribute("y"), z = +v.getAttribute("z");
        pos.push(x*M[0] + y*M[3] + z*M[6] + M[9], x*M[1] + y*M[4] + z*M[7] + M[10], x*M[2] + y*M[5] + z*M[8] + M[11]);
      }
      for (const t of Array.from(meshEl.getElementsByTagName("triangle"))) {
        tri.push(v0 + +t.getAttribute("v1"), v0 + +t.getAttribute("v2"), v0 + +t.getAttribute("v3"));
        if (!painted && t.getAttribute("paint_color")) painted = true;
      }
      meshes.push({ file: norm(file), objectId: String(id), name: obj.getAttribute("name") || "", triStart: t0, triCount: tri.length / 3 - t0 });
    }
    const compsEl = kids(obj).find((c) => c.localName === "components");
    if (compsEl) for (const c of kids(compsEl)) {
      if (c.localName !== "component") continue;
      const path = c.getAttribute("p:path") || c.getAttributeNS("http://schemas.microsoft.com/3dmanufacturing/production/2015/06", "path") || file;
      addObject(path, c.getAttribute("objectid"), mulT(parseT(c.getAttribute("transform")), M), depth + 1);
    }
  }
  const rootDoc = getDoc(root);
  const items = rootDoc.getElementsByTagName("item");
  if (items.length) for (const it of Array.from(items)) addObject(root, it.getAttribute("objectid"), parseT(it.getAttribute("transform")), 0);
  else for (const o of Array.from(rootDoc.getElementsByTagName("object"))) addObject(root, o.getAttribute("id"), I12, 0);
  if (!tri.length) throw new Error("No triangles found in 3MF");
  // Several meshes (a multi-part object, or several objects): each loads as a part, with OrcaSlicer's / Bambu
  // Studio's part name and filament (Metadata/model_settings.config) when the file has them. A painted file loads as
  // one model, so its paint can go back into it.
  let groups;
  if (meshes.length > 1 && !painted) {
    const cfg = {};
    const cf = files["Metadata/model_settings.config"];
    if (cf) for (const part of Array.from(parseXml(strFromU8(cf)).getElementsByTagName("part"))) {
      const md = {}; for (const m of Array.from(part.getElementsByTagName("metadata"))) md[m.getAttribute("key")] = m.getAttribute("value");
      cfg[part.getAttribute("id")] = { name: md.name, filament: +md.extruder || 0 };
    }
    groups = meshes.map((m) => ({ name: cfg[m.objectId]?.name || m.name, filament: cfg[m.objectId]?.filament || 0, count: m.triCount }));
  }
  return { pos: new Float32Array(pos), tri: new Uint32Array(tri), groups, source: { type: "3mf", files, meshes, painted } };
}

// Merge coincident vertices so faces share edges. Face order is preserved (needed to write paint back).
export function weld(pos, tri) {
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i+k]); mx[k] = Math.max(mx[k], pos[i+k]); }
  const eps = Math.max(1e-9, Math.hypot(mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]) * 1e-6);
  const map = new Map(), out = [], remap = new Uint32Array(pos.length / 3);
  for (let i = 0; i < pos.length / 3; i++) {
    const k = Math.round(pos[3*i]/eps) + "," + Math.round(pos[3*i+1]/eps) + "," + Math.round(pos[3*i+2]/eps);
    let j = map.get(k);
    if (j === undefined) { j = out.length / 3; map.set(k, j); out.push(pos[3*i], pos[3*i+1], pos[3*i+2]); }
    remap[i] = j;
  }
  const t = new Uint32Array(tri.length);
  for (let i = 0; i < tri.length; i++) t[i] = remap[tri[i]];
  return { pos: new Float32Array(out), tri: t };
}
export const soupIndex = (v) => Uint32Array.from({ length: v.length / 3 }, (_, i) => i);

// A new split of a loaded mesh (raw = { pos, tri, source }), welded, with its face graph, all faces Unassigned.
// raw.groups (optional): [{ name, filament, count }], the faces of raw.tri in order, one entry per part of a model
// that is already split (an OrcaSlicer object with several parts, a multi-part 3MF). Two or more groups load as
// those parts, and the cut caps that two touching parts share (each part closed over the same seam) are removed,
// so the parts join along their seams as one surface again. Nothing is moved or reshaped.
export function newSplit(name, raw) {
  let w = weld(raw.pos, raw.tri);
  const S = { name: name.replace(/\.[^.]+$/, ""), source: raw.source, active: 0, flipped: 0, refined: 0, coarse: null };
  const groups = (raw.groups || []).filter((g) => g.count > 0);
  let group = null; // part (1-based) of each face of w
  if (groups.length > 1 && groups.reduce((n, g) => n + g.count, 0) === w.tri.length / 3) {
    group = new Int32Array(w.tri.length / 3);
    let f = 0; groups.forEach((g, k) => group.fill(k + 1, f, (f += g.count)));
    const keep = sharedCaps(w.tri, group);
    if (keep) {
      const t = [], gr = [];
      for (let i = 0; i < keep.length; i++) if (keep[i]) { t.push(w.tri[3*i], w.tri[3*i+1], w.tri[3*i+2]); gr.push(group[i]); }
      const vmap = new Int32Array(w.pos.length / 3).fill(-1), P = [];
      for (let i = 0; i < t.length; i++) { const v = t[i]; if (vmap[v] < 0) { vmap[v] = P.length / 3; P.push(w.pos[3*v], w.pos[3*v+1], w.pos[3*v+2]); } t[i] = vmap[v]; }
      w = { pos: Float32Array.from(P), tri: Uint32Array.from(t) }; group = Int32Array.from(gr);
      S.capsRemoved = keep.length - gr.length;
      if (S.source?.type === "3mf") S.source = { ...S.source, type: "refined" }; // faces no longer match the file
    }
  }
  // Long, thin triangles (CAD exports: a box face is two triangles) hide creases from the splitter; split long
  // edges first. The surface is unchanged. The faces no longer match a source 3MF, so paint can't go back into it.
  const r = refineLong(w.pos, w.tri);
  if (r) {
    S.coarse = { faces: w.tri.length / 3, parent: r.parent }; S.refined = r.added;
    if (group) group = Int32Array.from(r.parent, (p) => group[p]);
    w = r; if (S.source?.type === "3mf") S.source = { type: "refined" };
  }
  setMesh(S, w.pos, w.tri);
  // Inside-out shells (normals pointing in) swap concave and convex: turn them right side out.
  const fl = flipInsideOut(S.pos, S.tri, S.G);
  if (fl) { S.flipped = fl; setMesh(S, S.pos, S.tri); }
  S.mesh0 = [S.pos, S.tri, S.G];
  S.labels = group || new Int32Array(S.nF);
  S.parts = [{ name: "Unassigned", color: UNASSIGNED_COLOR, filament: 1, seeds: [], visible: true }];
  if (group) {
    const first = new Int32Array(groups.length + 1).fill(-1); // a seed face in each part
    for (let f = 0; f < S.nF; f++) if (first[group[f]] < 0) first[group[f]] = f;
    groups.forEach((g, k) => S.parts.push(newPart(S, { ...(g.name ? { name: String(g.name) } : {}), ...(g.filament > 0 ? { filament: g.filament | 0 } : {}), seeds: first[k + 1] >= 0 ? [first[k + 1]] : [] })));
  }
  return S;
}

// Faces to keep (Uint8Array) once the caps over the cuts between touching parts are removed (each part was closed
// over its cut so it prints on its own). null when there are none. Two kinds:
// - a pair of faces from different parts on the same three vertices with opposite winding (both parts capped the
//   seam the same way);
// - a fan: every face around one vertex is in one part, the edges out of that vertex are each used twice, and the
//   edge across from it on each face is also used by another face (the cut's rim: the part's own surface and the
//   other part there). Mesh Splitter caps a cut with a fan around the cut's center, and two parts' fans differ where a cut
//   meets a third part.
// A cut whose parts were moved apart touches nothing, so its cap stays: that part's end, as it prints.
function sharedCaps(tri, group) {
  const n = tri.length / 3, byKey = new Map(), keep = new Uint8Array(n).fill(1);
  const key = (f) => [tri[3*f], tri[3*f+1], tri[3*f+2]].sort((a, b) => a - b).join(",");
  // the same corners in reverse cyclic order
  const opposite = (f, g) => { for (let r = 0; r < 3; r++) if (tri[3*f] === tri[3*g+r] && tri[3*f+1] === tri[3*g+(r+2)%3] && tri[3*f+2] === tri[3*g+(r+1)%3]) return true; return false; };
  let cut = 0;
  for (let f = 0; f < n; f++) {
    const a = tri[3*f], b = tri[3*f+1], c = tri[3*f+2];
    if (a === b || b === c || a === c) continue;
    const k = key(f), list = byKey.get(k);
    const j = list ? list.findIndex((g) => keep[g] && group[g] !== group[f] && opposite(f, g)) : -1;
    if (j >= 0) { keep[list[j]] = 0; keep[f] = 0; list.splice(j, 1); cut += 2; continue; }
    if (list) list.push(f); else byKey.set(k, [f]);
  }
  // fans
  const ek = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a), use = new Map(), ring = new Map();
  for (let f = 0; f < n; f++) if (keep[f]) for (let e = 0; e < 3; e++) {
    const a = tri[3*f+e], b = tri[3*f+(e+1)%3], k = ek(a, b);
    use.set(k, (use.get(k) || 0) + 1);
    let r = ring.get(a); if (!r) ring.set(a, (r = [])); r.push(f);
  }
  const fans = [];
  for (const [v, fs] of ring) {
    if (fs.length < 3 || fs.some((f) => group[f] !== group[fs[0]])) continue;
    let ok = true;
    for (const f of fs) {
      const e = [0, 1, 2].find((e) => tri[3*f+e] === v), a = tri[3*f+(e+1)%3], b = tri[3*f+(e+2)%3];
      if (use.get(ek(a, b)) < 3 || use.get(ek(v, a)) !== 2 || use.get(ek(v, b)) !== 2) { ok = false; break; }
    }
    if (ok) fans.push(fs);
  }
  for (const fs of fans) for (const f of fs) if (keep[f]) { keep[f] = 0; cut++; }
  return cut ? keep : null;
}
// Signed volume of each shell (divergence theorem); shells whose volume is negative and that don't sit inside
// another shell's box (an inner void is meant to face in) get their triangles' winding reversed, in place.
// Returns the number of shells flipped.
export function flipInsideOut(pos, tri, G) {
  const n = G.shells, vol = new Float64Array(n), box = Array.from({ length: n }, () => [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (let f = 0; f < G.nF; f++) {
    const s = G.shellOf[f], a = 3 * tri[3*f], b = 3 * tri[3*f+1], c = 3 * tri[3*f+2];
    vol[s] += (pos[a] * (pos[b+1] * pos[c+2] - pos[b+2] * pos[c+1]) - pos[a+1] * (pos[b] * pos[c+2] - pos[b+2] * pos[c]) + pos[a+2] * (pos[b] * pos[c+1] - pos[b+1] * pos[c])) / 6;
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) { box[s][k] = Math.min(box[s][k], pos[v+k]); box[s][k+3] = Math.max(box[s][k+3], pos[v+k]); }
  }
  const inside = (i, j) => [0, 1, 2].every((k) => box[i][k] >= box[j][k] && box[i][k+3] <= box[j][k+3]);
  const flip = new Uint8Array(n); let cnt = 0;
  for (let i = 0; i < n; i++) {
    const size = Math.max(1e-12, (box[i][3] - box[i][0]) * (box[i][4] - box[i][1]) * (box[i][5] - box[i][2]));
    if (vol[i] < -1e-6 * size && !vol.some((v, j) => j !== i && v > 0 && inside(i, j))) { flip[i] = 1; cnt++; }
  }
  if (cnt) for (let f = 0; f < G.nF; f++) if (flip[G.shellOf[f]]) { const t = tri[3*f+1]; tri[3*f+1] = tri[3*f+2]; tri[3*f+2] = t; }
  return cnt;
}

// Split every edge longer than maxLen at its midpoint, repeatedly, keeping the mesh conforming (a triangle with one,
// two or three long edges becomes two, three or four). maxLen defaults to 1/50 of the box diagonal, raised if the
// result would pass MAX_REFINE faces; with the default, only a mesh with many long edges (over REFINE_SHARE of its
// edges longer than both that and 8x the median edge) is refined, so finely meshed models are left as they are.
// Returns null when nothing is refined, else { pos, tri, added, parent } (parent: the input face each output face came from).
const MAX_REFINE = 600000, REFINE_SHARE = 0.02;
export function refineLong(pos, tri, maxLen = 0) {
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i+k]); mx[k] = Math.max(mx[k], pos[i+k]); }
  let L = maxLen || Math.hypot(mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]) / 50;
  const len = (P, a, b) => Math.hypot(P[3*a]-P[3*b], P[3*a+1]-P[3*b+1], P[3*a+2]-P[3*b+2]);
  if (!L) return null;
  if (!maxLen) { // only meshes made largely of long triangles: over REFINE_SHARE of edges past 8x the median edge
    const E = new Float32Array(tri.length);
    for (let f = 0; f < tri.length; f += 3) for (let e = 0; e < 3; e++) E[f+e] = len(pos, tri[f+e], tri[f+(e+1)%3]);
    const med = Float32Array.from(E).sort()[E.length >> 1], T = Math.max(L, 8 * med);
    let n = 0; for (const x of E) if (x > T) n++;
    if (n <= REFINE_SHARE * E.length) return null;
  } else {
    let any = false;
    for (let f = 0; f < tri.length && !any; f += 3) for (let e = 0; e < 3; e++) if (len(pos, tri[f+e], tri[f+(e+1)%3]) > L) { any = true; break; }
    if (!any) return null;
  }
  for (let attempt = 0; attempt < 8; attempt++, L *= 1.5) {
    let P = Array.from(pos), T = Array.from(tri), Par = Array.from({ length: tri.length / 3 }, (_, f) => f), ok = true;
    for (let pass = 0; pass < 24; pass++) {
      const nV = P.length / 3, mid = new Map();
      const m = (a, b) => {
        const key = a < b ? a * nV + b : b * nV + a;
        let v = mid.get(key);
        if (v === undefined) { v = P.length / 3; P.push((P[3*a]+P[3*b])/2, (P[3*a+1]+P[3*b+1])/2, (P[3*a+2]+P[3*b+2])/2); mid.set(key, v); }
        return v;
      };
      const out = [], par = []; let split = false;
      for (let f = 0; f < T.length; f += 3) {
        const v = [T[f], T[f+1], T[f+2]], long = [0, 1, 2].map((e) => len(P, v[e], v[(e+1)%3]) > L);
        const k = long.filter(Boolean).length;
        const n0 = out.length;
        if (!k) out.push(...v);
        else split = true;
        if (k === 3) {
          const ab = m(v[0], v[1]), bc = m(v[1], v[2]), ca = m(v[2], v[0]);
          out.push(v[0], ab, ca, ab, v[1], bc, ca, bc, v[2], ab, bc, ca);
        } else if (k === 1) {
          const e = long.indexOf(true), a = v[e], b = v[(e+1)%3], c = v[(e+2)%3], x = m(a, b);
          out.push(a, x, c, x, b, c);
        } else if (k === 2) { // two long edges: the corner between them is cut off, the rest split by its shorter diagonal
          const e = long.indexOf(false), a = v[(e+2)%3], b = v[e], c = v[(e+1)%3]; // b->c is the short edge; a is the corner
          const x = m(a, b), y = m(c, a);
          out.push(a, x, y);
          if (len(P, x, c) <= len(P, b, y)) out.push(x, b, c, x, c, y); else out.push(x, b, y, b, c, y);
        }
        for (let j = n0; j < out.length; j += 3) par.push(Par[f / 3]);
      }
      T = out; Par = par;
      if (T.length / 3 > MAX_REFINE) { ok = false; break; }
      if (!split) break;
    }
    if (ok) return { pos: Float32Array.from(P), tri: Uint32Array.from(T), added: T.length / 3 - tri.length / 3, parent: Uint32Array.from(Par) };
  }
  return null;
}
export function setMesh(S, pos, tri, G = null) {
  S.pos = pos; S.tri = tri; S.nV = pos.length / 3; S.nF = tri.length / 3;
  S.G = G || buildGraph(pos, tri);
}
