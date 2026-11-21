// Reading meshes (STL, 3MF), welding, long-edge refinement, inside-out repair, and a new split of a loaded mesh.
import { unzipSync, strFromU8 } from "fflate";
import { buildGraph, components } from "./graph.js";
import { UNASSIGNED_COLOR } from "./parts.js";

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
      for (const t of Array.from(meshEl.getElementsByTagName("triangle")))
        tri.push(v0 + +t.getAttribute("v1"), v0 + +t.getAttribute("v2"), v0 + +t.getAttribute("v3"));
      meshes.push({ file: norm(file), objectId: String(id), triStart: t0, triCount: tri.length / 3 - t0 });
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
  return { pos: new Float32Array(pos), tri: new Uint32Array(tri), source: { type: "3mf", files, meshes } };
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
export function newSplit(name, raw) {
  let w = weld(raw.pos, raw.tri);
  const S = { name: name.replace(/\.[^.]+$/, ""), source: raw.source, active: 0, flipped: 0, refined: 0, coarse: null };
  // Long, thin triangles (CAD exports: a box face is two triangles) hide creases from the splitter; split long
  // edges first. The surface is unchanged. The faces no longer match a source 3MF, so paint can't go back into it.
  const r = refineLong(w.pos, w.tri);
  if (r) { S.coarse = { faces: w.tri.length / 3, parent: r.parent }; w = r; S.refined = r.added; if (S.source?.type === "3mf") S.source = { type: "refined" }; }
  setMesh(S, w.pos, w.tri);
  // Inside-out shells (normals pointing in) swap concave and convex: turn them right side out.
  const fl = flipInsideOut(S.pos, S.tri, S.G);
  if (fl) { S.flipped = fl; setMesh(S, S.pos, S.tri); }
  S.mesh0 = [S.pos, S.tri, S.G];
  S.labels = new Int32Array(S.nF);
  S.parts = [{ name: "Unassigned", color: UNASSIGNED_COLOR, filament: 1, seeds: [], visible: true }];
  return S;
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

// ---------------------------------------------------------------- floating spots
// The plate is at the model's lowest point. A spot (feet, say) whose own bottom is a little above it would print in
// mid-air. Spots: connected patches of vertices within max + band mm of the plate; a patch whose lowest point is
// 0.02..max mm up floats. Returns [{ gap, low (its lowest vertex), verts }], highest gap first.
export const FLOAT = { max: 3, band: 5, tol: 0.02 };
export function floatingSpots(pos, tri, o = FLOAT) {
  const nV = pos.length / 3; let z0 = Infinity;
  for (let i = 0; i < nV; i++) z0 = Math.min(z0, pos[3*i+2]);
  const top = z0 + o.max + o.band, inB = (v) => pos[3*v+2] <= top;
  const head = new Int32Array(nV).fill(-1), nxt = [], to = []; // vertex adjacency inside the band
  const link = (a, b) => { to.push(b); nxt.push(head[a]); head[a] = to.length - 1; };
  for (let f = 0; f < tri.length; f += 3) for (let k = 0; k < 3; k++) {
    const a = tri[f+k], b = tri[f+(k+1)%3];
    if (inB(a) && inB(b)) { link(a, b); link(b, a); }
  }
  const seen = new Uint8Array(nV), out = [];
  for (let s = 0; s < nV; s++) {
    if (seen[s] || !inB(s)) continue;
    const verts = [s]; seen[s] = 1; let low = s;
    for (let q = 0; q < verts.length; q++) for (let e = head[verts[q]]; e >= 0; e = nxt[e]) {
      const v = to[e]; if (seen[v]) continue; seen[v] = 1; verts.push(v); if (pos[3*v+2] < pos[3*low+2]) low = v;
    }
    const gap = pos[3*low+2] - z0;
    if (gap > o.tol && gap <= o.max) out.push({ gap, low, verts: Uint32Array.from(verts) });
  }
  return out.sort((a, b) => b.gap - a.gap);
}
// Pull floating spots down onto the plate: a vertex s mm above its spot's bottom moves down by gap x w(s), w falling
// from 1 at the bottom to 0 at band mm (cosine), so the spot's lower band mm stretch and nothing above it moves.
// z' = z - gap*w(z) only grows with z, so the surface never folds. Returns new positions (pos is not changed).
export function dropSpots(pos, spots, band = FLOAT.band) {
  const P = Float32Array.from(pos);
  for (const sp of spots) {
    const b = pos[3*sp.low+2];
    for (const v of sp.verts) {
      const s = pos[3*v+2] - b;
      if (s < band) P[3*v+2] -= sp.gap * 0.5 * (1 + Math.cos(Math.PI * Math.max(0, s) / band));
    }
  }
  return P;
}
