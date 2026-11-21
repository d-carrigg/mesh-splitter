// Mesh Splitter core: mesh parsing, the face graph, the splitting algorithms and the file writers.
// No DOM, three.js or UI state: the browser app (app/index.html) and the command line (cli/split.mjs) both
// import this module, so a split made from the command line matches one made in the app.
//
// A "split" object holds the working state that these functions read and change:
//   { name, pos: Float32Array, tri: Uint32Array, nV, nF, G: face graph, labels: Int32Array part per face,
//     parts: [{ name, color, filament, seeds: [face], visible }], active }   (parts[0] is "Unassigned")
// Options: step = crease step (deg, the app's "Crease" slider), smooth = concavity smoothing passes ("Denoise").
import { unzipSync, zipSync, zlibSync, unzlibSync, strFromU8, strToU8 } from "fflate";

export const PALETTE = ["#e6194b","#3cb44b","#4363d8","#f58231","#911eb4","#42d4f4","#f032e6","#bfef45",
                        "#fabed4","#469990","#dcbeff","#9a6324","#fffac8","#800000","#aaffc3","#000075"];
export const UNASSIGNED_COLOR = "#9aa0a8";
export const DEFAULTS = { step: 2, smooth: 4 };

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

const ETA = 0.15; // convex edges count this much of a concave one

// ---------------------------------------------------------------- face graph
// Dual graph: node = face, edge = shared mesh edge. Each edge stores a geodesic length
// (centroid -> edge midpoint -> centroid) and an angular distance that is large across concave
// creases and small across convex ones (Katz & Tal 2003, "Hierarchical mesh decomposition using
// fuzzy clustering and cuts"). Parts are separated where the surface folds inward (minima rule,
// Hoffman & Richards 1984).
export function buildGraph(pos, tri) {
  const nF = tri.length / 3, nV = pos.length / 3;
  const nrm = new Float32Array(nF * 3), cen = new Float32Array(nF * 3), area = new Float32Array(nF);
  const bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nV; i++) for (let k = 0; k < 3; k++) { bbox[k] = Math.min(bbox[k], pos[3*i+k]); bbox[k+3] = Math.max(bbox[k+3], pos[3*i+k]); }
  for (let f = 0; f < nF; f++) {
    const a = tri[3*f]*3, b = tri[3*f+1]*3, c = tri[3*f+2]*3;
    const ux = pos[b]-pos[a], uy = pos[b+1]-pos[a+1], uz = pos[b+2]-pos[a+2];
    const vx = pos[c]-pos[a], vy = pos[c+1]-pos[a+1], vz = pos[c+2]-pos[a+2];
    let nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
    const l = Math.hypot(nx, ny, nz); area[f] = l / 2;
    if (l > 0) { nx /= l; ny /= l; nz /= l; }
    nrm[3*f] = nx; nrm[3*f+1] = ny; nrm[3*f+2] = nz;
    for (let k = 0; k < 3; k++) cen[3*f+k] = (pos[a+k] + pos[b+k] + pos[c+k]) / 3;
  }
  // edge -> faces
  const emap = new Map();
  for (let f = 0; f < nF; f++) for (let e = 0; e < 3; e++) {
    const a = tri[3*f+e], b = tri[3*f+(e+1)%3];
    if (a === b) continue;
    const key = a < b ? a * nV + b : b * nV + a;
    const cur = emap.get(key);
    if (cur === undefined) emap.set(key, f);
    else if (typeof cur === "number") emap.set(key, [cur, f]);
    else cur.push(f);
  }
  const EA = [], EB = [], EGEO = [], EANG = [], ETH = [], ECONC = [];
  for (const [key, val] of emap) {
    if (typeof val === "number") continue;
    const va = Math.floor(key / nV), vb = key % nV;
    const mx = (pos[3*va] + pos[3*vb]) / 2, my = (pos[3*va+1] + pos[3*vb+1]) / 2, mz = (pos[3*va+2] + pos[3*vb+2]) / 2;
    for (let i = 0; i < val.length; i++) for (let j = i + 1; j < val.length; j++) {
      const f = val[i], g = val[j];
      const geo = Math.hypot(cen[3*f]-mx, cen[3*f+1]-my, cen[3*f+2]-mz) + Math.hypot(cen[3*g]-mx, cen[3*g+1]-my, cen[3*g+2]-mz);
      let cos = nrm[3*f]*nrm[3*g] + nrm[3*f+1]*nrm[3*g+1] + nrm[3*f+2]*nrm[3*g+2];
      cos = Math.max(-1, Math.min(1, cos));
      // convex if normals diverge in the direction of travel
      const conv = (nrm[3*g]-nrm[3*f])*(cen[3*g]-cen[3*f]) + (nrm[3*g+1]-nrm[3*f+1])*(cen[3*g+1]-cen[3*f+1]) + (nrm[3*g+2]-nrm[3*f+2])*(cen[3*g+2]-cen[3*f+2]);
      const concave = conv < 0;
      EA.push(f); EB.push(g); EGEO.push(geo); ETH.push(Math.acos(cos) * 180 / Math.PI);
      ECONC.push(concave ? 1 : 0); EANG.push((concave ? 1 : ETA) * (1 - cos));
    }
  }
  const nE = EA.length;
  let mg = 0, ma = 0;
  for (let i = 0; i < nE; i++) { mg += EGEO[i]; ma += EANG[i]; }
  mg = mg / Math.max(1, nE) || 1; ma = ma / Math.max(1, nE) || 1e-6;
  const geoN = new Float32Array(nE), angN = new Float32Array(nE);
  for (let i = 0; i < nE; i++) { geoN[i] = EGEO[i] / mg; angN[i] = EANG[i] / ma; }
  // CSR adjacency
  const deg = new Int32Array(nF + 1);
  for (let i = 0; i < nE; i++) { deg[EA[i] + 1]++; deg[EB[i] + 1]++; }
  for (let f = 0; f < nF; f++) deg[f + 1] += deg[f];
  const adjN = new Int32Array(2 * nE), adjE = new Int32Array(2 * nE), fill = deg.slice(0, nF);
  for (let i = 0; i < nE; i++) {
    adjN[fill[EA[i]]] = EB[i]; adjE[fill[EA[i]]++] = i;
    adjN[fill[EB[i]]] = EA[i]; adjE[fill[EB[i]]++] = i;
  }
  const theta = Float32Array.from(ETH), concave = Uint8Array.from(ECONC);
  const bar = new Float32Array(nE); for (let i = 0; i < nE; i++) bar[i] = concave[i] ? theta[i] : ETA * theta[i];
  const G = { nF, nE, nrm, cen, area, adjS: deg, adjN, adjE, geoN, angN, theta, concave, bar, bbox, ea: Int32Array.from(EA), eb: Int32Array.from(EB), barIters: -1,
    diag: Math.hypot(bbox[3]-bbox[0], bbox[4]-bbox[1], bbox[5]-bbox[2]) };
  G.shellOf = components(G); G.shells = G.shellOf.count;
  return G;
}

export function components(G) {
  const comp = new Int32Array(G.nF).fill(-1); let n = 0; const stack = [];
  for (let s = 0; s < G.nF; s++) {
    if (comp[s] >= 0) continue;
    comp[s] = n; stack.push(s);
    while (stack.length) {
      const f = stack.pop();
      for (let k = G.adjS[f]; k < G.adjS[f + 1]; k++) { const g = G.adjN[k]; if (comp[g] < 0) { comp[g] = n; stack.push(g); } }
    }
    n++;
  }
  comp.count = n; return comp;
}

// ---------------------------------------------------------------- algorithms
export class Heap { // min-heap of (key, value)
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
    if (n) {
      let i = 0;
      for (;;) { let c = 2*i + 1; if (c >= n) break; if (c + 1 < n && k[c+1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

// Smoothed concavity per face: signed dihedral (concave < 0) averaged over the face's edges, then
// Laplacian-smoothed over neighbors so triangle noise cancels while real fillets/creases remain.
// Edge barrier = the larger concavity of its two faces (degrees).
export function computeBarrier(G, iters) {
  const h = new Float32Array(G.nF), cnt = new Float32Array(G.nF);
  for (let e = 0; e < G.nE; e++) {
    const sgn = G.concave[e] ? -G.theta[e] : ETA * G.theta[e];
    const a = G.ea[e], b = G.eb[e]; h[a] += sgn; h[b] += sgn; cnt[a]++; cnt[b]++;
  }
  for (let f = 0; f < G.nF; f++) if (cnt[f]) h[f] /= cnt[f];
  let cur = h, nxt = new Float32Array(G.nF);
  for (let it = 0; it < iters; it++) {
    for (let f = 0; f < G.nF; f++) {
      let s = cur[f], n = 1;
      for (let k = G.adjS[f]; k < G.adjS[f + 1]; k++) { s += cur[G.adjN[k]]; n++; }
      nxt[f] = s / n;
    }
    [cur, nxt] = [nxt, cur];
  }
  const conc = new Float32Array(G.nF);
  for (let f = 0; f < G.nF; f++) conc[f] = Math.max(0, -cur[f]);
  for (let e = 0; e < G.nE; e++) G.bar[e] = Math.max(conc[G.ea[e]], conc[G.eb[e]]);
  G.barIters = iters;
}
export function ensureBarrier(G, smooth) { if (G.barIters !== smooth) computeBarrier(G, smooth); }

// Multi-source watershed on the face graph: each face goes to the seed reachable with the lowest
// worst crease along the path (minimax); ties broken by geodesic distance. A big part therefore
// keeps its whole smooth surface instead of losing its far side to a nearby small part.
// Edge barrier in "steps": concave dihedral angle (convex counts ETA of it), quantized by the
// crease step so that sub-step noise is free and only real creases separate regions.
// sources: [[face, label], ...]. mask: Uint8Array or null. Returns composite key per face.
const BIG = 1e7;
export function grow(G, sources, mask, step, smooth) {
  ensureBarrier(G, smooth);
  const dist = new Float64Array(G.nF).fill(Infinity), lab = new Int32Array(G.nF).fill(-1), h = new Heap();
  const q = new Float64Array(G.nF), geo = new Float64Array(G.nF);
  for (const [f, l] of sources) { if (mask && !mask[f]) continue; dist[f] = 0; q[f] = 0; geo[f] = 0; lab[f] = l; h.push(0, f); }
  while (h.size) {
    const f = h.pop();
    for (let k = G.adjS[f]; k < G.adjS[f + 1]; k++) {
      const g = G.adjN[k]; if (mask && !mask[g]) continue;
      const e = G.adjE[k];
      const qg = step > 0 ? Math.max(q[f], Math.floor(G.bar[e] / step)) : 0, gg = geo[f] + G.geoN[e];
      const d = qg * BIG + gg;
      if (d < dist[g]) { dist[g] = d; q[g] = qg; geo[g] = gg; lab[g] = lab[f]; h.push(d, g); }
    }
  }
  return { dist, lab };
}

// Grow the seeded parts over Unassigned faces. opts.only: re-grow just these parts (and Unassigned) from their
// seeds, leaving every other part as it is. Returns { faces, parts } or throws if no part has seeds.
export function segmentFromSeeds(S, opts = {}) {
  const { step = DEFAULTS.step, smooth = DEFAULTS.smooth } = opts;
  const seeded = new Set(), src = [];
  S.parts.forEach((p, i) => { if (i > 0 && (!opts.only || opts.only.includes(i)) && p.seeds.length) { seeded.add(i); p.seeds.forEach((f) => src.push([f, i])); } });
  if (opts.only) opts.only.forEach((i) => i > 0 && seeded.add(i));
  if (!src.length) throw new Error("Add seeds first: make a part, pick the Seed tool and click on the model.");
  const mask = new Uint8Array(S.nF);
  for (let f = 0; f < S.nF; f++) mask[f] = (S.labels[f] === 0 || seeded.has(S.labels[f])) ? 1 : 0;
  const { lab } = grow(S.G, src, mask, step, smooth);
  let n = 0;
  for (let f = 0; f < S.nF; f++) if (mask[f] && lab[f] >= 0) { S.labels[f] = lab[f]; n++; }
  snapCreases(S, mask, smooth); smoothCut(S, mask);
  return { faces: n, parts: seeded.size };
}

// Seeds by farthest-point sampling, then Lloyd-style refinement: each region's seed moves to its
// deepest face (farthest from the region boundary), regions are re-grown, repeat.
// k = 0 picks the count: over-split, then merge neighbors whose shared boundary is not a crease.
// opts.scope: split only this part (else the whole model, replacing the old parts). Returns the part count.
export function autoSplit(S, k, opts = {}) {
  const { step = DEFAULTS.step, smooth = DEFAULTS.smooth, scope = -1 } = opts;
  const mask = new Uint8Array(S.nF);
  let first = -1, count = 0;
  for (let f = 0; f < S.nF; f++) if (scope < 0 || S.labels[f] === scope) { mask[f] = 1; count++; if (first < 0) first = f; }
  const auto = !k;
  if (auto) k = Math.min(32, Math.max(16, S.G.shells + 8), Math.floor(count / 50));
  if (count < k || k < 1) throw new Error("Not enough faces in scope.");
  const G = S.G, L = step;
  const run = (k) => {
    let seeds = [];
    // handle disconnected scope: one farthest pass per call is fine; unreached faces get seeds later
    let d = grow(G, [[first, 0]], mask, 0, smooth).dist;
    let far = argmaxFinite(d, mask); seeds.push(far);
    while (seeds.length < k) {
      d = grow(G, seeds.map((s) => [s, 0]), mask, 0, smooth).dist;
      // unreached faces (another shell) first
      let un = -1; for (let f = 0; f < S.nF; f++) if (mask[f] && d[f] === Infinity) { un = f; break; }
      seeds.push(un >= 0 ? un : argmaxFinite(d, mask));
    }
    let lab;
    for (let it = 0; it < 8; it++) {
      lab = grow(G, seeds.map((s, i) => [s, i]), mask, L, smooth).lab;
      const next = deepestPerRegion(G, lab, mask, k, seeds);
      if (next.every((s, i) => s === seeds[i])) break;
      seeds = next;
    }
    lab = grow(G, seeds.map((s, i) => [s, i]), mask, L, smooth).lab;
    absorbTiny(G, lab, mask, Math.max(20, count * 0.003), smooth);
    return { seeds, lab };
  };
  let { seeds, lab } = run(k);
  if (auto) mergeWeak(G, lab, mask, step, smooth);
  else if (regionCount(lab, mask) < k) { // tiny regions were absorbed: start from more seeds, then merge down to k
    for (let extra = 1; extra <= k && k + extra <= count; extra = Math.min(2 * extra, k)) {
      const r = run(k + extra);
      if (regionCount(r.lab, mask) >= k) { ({ seeds, lab } = r); mergeWeak(G, lab, mask, step, smooth, k); break; }
      if (extra === k) break;
    }
  }
  if (scope < 0) { S.parts = [S.parts[0]]; S.active = 0; } // whole-model split replaces the old parts
  const used = new Map();
  for (let f = 0; f < S.nF; f++) if (mask[f] && lab[f] >= 0) {
    if (!used.has(lab[f])) used.set(lab[f], 0);
    used.set(lab[f], used.get(lab[f]) + 1);
  }
  const order = [...used.keys()].sort((a, b) => used.get(b) - used.get(a));
  const idx = new Map();
  for (const r of order) {
    idx.set(r, S.parts.length);
    S.parts.push(newPart(S, { seeds: [seeds[r]] }));
  }
  for (let f = 0; f < S.nF; f++) if (mask[f] && lab[f] >= 0) S.labels[f] = idx.get(lab[f]);
  if (scope > 0) S.parts[scope].seeds = [];
  const p0 = S.parts.length - order.length, made = S.parts.slice(p0);
  snapCreases(S, mask, smooth); smoothCut(S, mask);
  // a region the clean-up emptied (its seed face went to a neighbor) is dropped with its seed
  const cnt = partCounts(S);
  made.forEach((p, j) => { if (!cnt[p0 + j]) p.seeds = []; });
  dropEmptyParts(S);
  return made.filter((p) => S.parts.includes(p)).length;
}

// Merge adjacent regions whose shared boundary does not follow a concave crease: length-weighted mean
// edge barrier (smoothed concavity, deg) below the threshold, weakest boundary first. The threshold is 3 crease steps
// up to the default step (AUTO_CREASE = 6 deg at 2), 2 steps past it, so lowering the Crease slider finds softer
// creases (a teddy bear's limbs). target > 0: merge the weakest boundaries, whatever their crease, until target regions
// are left. Returns the region count.
const AUTO_CREASE = 6;
function mergeWeak(G, lab, mask, step, smooth, target = 0) {
  ensureBarrier(G, smooth);
  const T = target ? Infinity : Math.max(AUTO_CREASE * Math.min(step, DEFAULTS.step) / DEFAULTS.step, 2 * step), par = new Map();
  const find = (a) => { while (par.get(a) !== a) { par.set(a, par.get(par.get(a))); a = par.get(a); } return a; };
  for (let f = 0; f < G.nF; f++) if (mask[f] && lab[f] >= 0) par.set(lab[f], lab[f]);
  for (;;) {
    const B = new Map(); // "a,b" -> [sum bar * len, len]
    for (let e = 0; e < G.nE; e++) {
      const fa = G.ea[e], fb = G.eb[e]; if (!mask[fa] || !mask[fb] || lab[fa] < 0 || lab[fb] < 0) continue;
      const a = find(lab[fa]), b = find(lab[fb]); if (a === b) continue;
      const key = a < b ? a + "," + b : b + "," + a, w = G.geoN[e] || 1, cur = B.get(key) || [0, 0];
      cur[0] += G.bar[e] * w; cur[1] += w; B.set(key, cur);
    }
    let roots = 0; for (const [k, v] of par) if (k === v) roots++;
    if (target && roots <= target) break;
    let best = null, bv = T;
    for (const [key, [sb, sl]] of B) if (sb / sl < bv) { bv = sb / sl; best = key; }
    if (!best) break;
    const [a, b] = best.split(",").map(Number); par.set(b, a);
  }
  for (let f = 0; f < G.nF; f++) if (mask[f] && lab[f] >= 0) lab[f] = find(lab[f]);
  return new Set([...par.keys()].map(find)).size;
}
const regionCount = (lab, mask) => { const s = new Set(); for (let f = 0; f < lab.length; f++) if (mask[f] && lab[f] >= 0) s.add(lab[f]); return s.size; };

// Regions smaller than minSize (pits, noise) are re-grown from their neighbors.
function absorbTiny(G, lab, mask, minSize, smooth) {
  const nF = G.nF, size = new Map();
  for (let f = 0; f < nF; f++) if (mask[f] && lab[f] >= 0) size.set(lab[f], (size.get(lab[f]) || 0) + 1);
  const tiny = new Set([...size].filter(([, n]) => n < minSize).map(([l]) => l));
  if (!tiny.size || tiny.size === size.size) return;
  const m2 = new Uint8Array(nF), src = [], was = Int32Array.from(lab);
  for (let f = 0; f < nF; f++) if (mask[f] && tiny.has(lab[f])) { m2[f] = 1; lab[f] = -1; }
  for (let f = 0; f < nF; f++) if (m2[f]) for (let k = G.adjS[f]; k < G.adjS[f + 1]; k++) {
    const g = G.adjN[k]; if (mask[g] && !m2[g] && lab[g] >= 0) { src.push([g, lab[g]]); m2[g] = 1; }
  }
  const r = grow(G, src, m2, 0, smooth).lab;
  for (let f = 0; f < nF; f++) if (m2[f] && lab[f] < 0) lab[f] = r[f] >= 0 ? r[f] : was[f]; // a small separate shell stays a part
}

function argmaxFinite(d, mask) {
  let best = -1, bv = -1;
  for (let f = 0; f < d.length; f++) if (mask[f] && d[f] !== Infinity && d[f] > bv) { bv = d[f]; best = f; }
  return best;
}

function deepestPerRegion(G, lab, mask, k, oldSeeds) {
  const nF = G.nF, src = [];
  for (let f = 0; f < nF; f++) {
    if (!mask[f] || lab[f] < 0) continue;
    for (let j = G.adjS[f]; j < G.adjS[f + 1]; j++) { const g = G.adjN[j]; if (!mask[g] || lab[g] !== lab[f]) { src.push([f, lab[f]]); break; } }
  }
  // restrict propagation to stay inside each region: run per-label masked growth in one pass by
  // forbidding label changes (a face is only relaxed from a source with the same region label)
  const dist = new Float64Array(nF).fill(Infinity), h = new Heap();
  for (const [f] of src) { dist[f] = 0; h.push(0, f); }
  while (h.size) {
    const f = h.pop();
    for (let j = G.adjS[f]; j < G.adjS[f + 1]; j++) {
      const g = G.adjN[j]; if (!mask[g] || lab[g] !== lab[f]) continue;
      const e = G.adjE[j], d = dist[f] + G.geoN[e];
      if (d < dist[g]) { dist[g] = d; h.push(d, g); }
    }
  }
  const best = oldSeeds.slice(), bv = new Float64Array(k).fill(-1);
  for (let f = 0; f < nF; f++) {
    if (!mask[f] || lab[f] < 0) continue;
    const v = dist[f] === Infinity ? 1e30 : dist[f];
    if (v > bv[lab[f]]) { bv[lab[f]] = v; best[lab[f]] = f; }
  }
  return best;
}

// One part per connected shell (largest first; past 64, the rest share one part). Throws for a single shell.
export function splitShells(S) {
  const c = S.G.shellOf;
  if (c.count < 2) throw new Error("The mesh is one connected shell. Use seeds or auto split.");
  const sizes = new Array(c.count).fill(0);
  for (let f = 0; f < S.nF; f++) sizes[c[f]]++;
  const order = sizes.map((s, i) => i).sort((a, b) => sizes[b] - sizes[a]);
  const MAX = 64, idx = new Int32Array(c.count);
  S.parts = [S.parts[0]];
  S.parts[0].seeds = [];
  order.forEach((sh, r) => {
    if (r < MAX) { idx[sh] = S.parts.length; S.parts.push(newPart(S, { name: `Shell ${r + 1}` })); }
    else { if (r === MAX) S.parts.push(newPart(S, { name: "Small shells" })); idx[sh] = S.parts.length - 1; }
  });
  for (let f = 0; f < S.nF; f++) S.labels[f] = idx[c[f]];
  return S.parts.length - 1;
}

// ---------------------------------------------------------------- parts
export function newPart(S, o = {}) {
  const i = S.parts.length - 1;
  const used = new Set(S.parts.map((p) => p.color));
  const color = PALETTE.find((c) => !used.has(c)) || PALETTE[i % PALETTE.length];
  const fils = new Set(S.parts.slice(1).map((p) => p.filament));
  let fil = 2; while (fils.has(fil) && fil < 16) fil++;
  const names = new Set(S.parts.map((p) => p.name)); let k = 1; while (names.has(`Part ${k}`)) k++;
  return Object.assign({ name: `Part ${k}`, color, filament: fil, seeds: [], visible: true }, o);
}

export function dropEmptyParts(S) {
  const cnt = new Int32Array(S.parts.length);
  for (let f = 0; f < S.nF; f++) cnt[S.labels[f]]++;
  const keep = S.parts.map((p, i) => i === 0 || cnt[i] > 0 || p.seeds.length > 0 || i === S.active);
  if (keep.every(Boolean)) return;
  const remap = new Int32Array(S.parts.length); let j = 0;
  S.parts.forEach((p, i) => { remap[i] = keep[i] ? j++ : 0; });
  for (let f = 0; f < S.nF; f++) S.labels[f] = remap[S.labels[f]];
  S.active = remap[S.active];
  S.parts = S.parts.filter((_, i) => keep[i]);
}

export function partCounts(S) { const c = new Int32Array(S.parts.length); for (let f = 0; f < S.nF; f++) c[S.labels[f]]++; return c; }

// ---------------------------------------------------------------- boundary clean-up
// Crease snapping. Watershed boundaries can leave a flap of one part lying on its neighbor's smooth surface,
// short of the crease where the two actually meet; smoothing alone only rounds the flap off. For every pair of
// touching parts, faces within SNAP_RINGS of their shared boundary are relabeled by an s-t minimum cut on the
// face graph, where cutting edge e costs len(e) * (SNAP_EPS + exp(-crease(e) / SNAP_DEG)): a boundary along a
// concave crease is nearly free, one across a smooth surface costs its length. Faces outside the band, seed
// faces, and other parts stay put. mask: only these faces may change. Returns faces relabeled.
const SNAP_RINGS = 12, SNAP_EPS = 0.03, SNAP_DEG = 10;
function maxflowCut(n, eu, ev, cap, src, snk) { // Dinic on an undirected graph; returns 1 for nodes on the source side
  const m = eu.length, head = new Int32Array(n).fill(-1), nxt = new Int32Array(4 * m), to = new Int32Array(4 * m), c = new Float64Array(4 * m);
  let k = 0;
  const add = (a, b, w) => { to[k] = b; c[k] = w; nxt[k] = head[a]; head[a] = k++; to[k] = a; c[k] = 0; nxt[k] = head[b]; head[b] = k++; };
  for (let i = 0; i < m; i++) { add(eu[i], ev[i], cap[i]); add(ev[i], eu[i], cap[i]); }
  const lvl = new Int32Array(n), it = new Int32Array(n), q = new Int32Array(n);
  const bfs = () => {
    lvl.fill(-1); lvl[src] = 0; let h = 0, t = 0; q[t++] = src;
    while (h < t) { const a = q[h++]; for (let e = head[a]; e >= 0; e = nxt[e]) if (c[e] > 1e-12 && lvl[to[e]] < 0) { lvl[to[e]] = lvl[a] + 1; q[t++] = to[e]; } }
    return lvl[snk] >= 0;
  };
  const stE = new Int32Array(n), stN = new Int32Array(n + 1);
  const dfs = () => { // iterative blocking-flow augment along level graph; returns pushed amount
    let d = 0; stN[0] = src;
    while (true) {
      const a = stN[d];
      if (a === snk) {
        let f = Infinity; for (let i = 0; i < d; i++) f = Math.min(f, c[stE[i]]);
        for (let i = 0; i < d; i++) { c[stE[i]] -= f; c[stE[i] ^ 1] += f; }
        return f;
      }
      let e = it[a];
      for (; e >= 0; e = nxt[e]) if (c[e] > 1e-12 && lvl[to[e]] === lvl[a] + 1) break;
      it[a] = e;
      if (e < 0) { if (!d) return 0; lvl[a] = -1; d--; it[stN[d]] = nxt[it[stN[d]]]; continue; }
      stE[d] = e; stN[++d] = to[e];
    }
  };
  while (bfs()) { for (let i = 0; i < n; i++) it[i] = head[i]; while (dfs() > 0); }
  const side = new Uint8Array(n); let h = 0, t = 0; q[t++] = src; side[src] = 1;
  while (h < t) { const a = q[h++]; for (let e = head[a]; e >= 0; e = nxt[e]) if (c[e] > 1e-12 && !side[to[e]]) { side[to[e]] = 1; q[t++] = to[e]; } }
  return side;
}
export function snapCreases(S, mask = null, smooth = DEFAULTS.smooth) {
  const G = S.G, L = S.labels, tri = S.tri, pos = S.pos;
  ensureBarrier(G, smooth);
  const ok = (f) => !mask || mask[f];
  const fixed = new Uint8Array(S.nF);
  for (const p of S.parts) for (const f of p.seeds) if (f >= 0 && f < S.nF) fixed[f] = 1;
  const elen = (e) => { // length of the mesh edge shared by the two faces of dual edge e
    const f = G.ea[e], g = G.eb[e], sh = [];
    for (let i = 0; i < 3; i++) { const v = tri[3*f+i]; if (v === tri[3*g] || v === tri[3*g+1] || v === tri[3*g+2]) sh.push(v); }
    if (sh.length < 2) return 0;
    const [a, b] = sh; return Math.hypot(pos[3*a]-pos[3*b], pos[3*a+1]-pos[3*b+1], pos[3*a+2]-pos[3*b+2]);
  };
  const cost = (e) => elen(e) * (SNAP_EPS + Math.exp(-Math.max(G.bar[e], G.concave[e] ? G.theta[e] : 0) / SNAP_DEG));
  const pairs = new Set();
  for (let e = 0; e < G.nE; e++) {
    const a = L[G.ea[e]], b = L[G.eb[e]];
    if (a !== b && a > 0 && b > 0 && ok(G.ea[e]) && ok(G.eb[e])) pairs.add(a < b ? a * 65536 + b : b * 65536 + a);
  }
  let changed = 0;
  const ring = new Int32Array(S.nF), idx = new Int32Array(S.nF);
  for (const key of pairs) {
    const A = Math.floor(key / 65536), B = key % 65536;
    const inAB = (f) => (L[f] === A || L[f] === B) && ok(f) && !fixed[f];
    ring.fill(-1);
    let front = [];
    for (let e = 0; e < G.nE; e++) {
      const f = G.ea[e], g = G.eb[e];
      if (L[f] !== L[g] && inAB(f) && inAB(g)) for (const h of [f, g]) if (ring[h] < 0) { ring[h] = 0; front.push(h); }
    }
    const band = front.slice();
    for (let r = 1; r < SNAP_RINGS && front.length; r++) {
      const nx = [];
      for (const f of front) for (let k = G.adjS[f]; k < G.adjS[f + 1]; k++) { const g = G.adjN[k]; if (ring[g] < 0 && inAB(g)) { ring[g] = r; nx.push(g); } }
      band.push(...nx); front = nx;
    }
    if (band.length < 2) continue;
    band.forEach((f, i) => (idx[f] = i));
    const n = band.length + 2, src = n - 2, snk = n - 1, eu = [], ev = [], cap = [];
    for (const f of band) for (let k = G.adjS[f]; k < G.adjS[f + 1]; k++) {
      const g = G.adjN[k], e = G.adjE[k];
      if (ring[g] >= 0) { if (f < g) { eu.push(idx[f]); ev.push(idx[g]); cap.push(cost(e)); } }
      else if (L[g] === A) { eu.push(idx[f]); ev.push(src); cap.push(cost(e)); }   // neighbor outside the band keeps its label
      else if (L[g] === B) { eu.push(idx[f]); ev.push(snk); cap.push(cost(e)); }
    }
    const side = maxflowCut(n, eu, ev, cap, src, snk);
    // a cut that swallows most of one side's band is erasing a small part, not moving a boundary: skip it
    let a0 = 0, b0 = 0, a1 = 0, b1 = 0;
    for (const f of band) { if (L[f] === A) a0++; else b0++; if (side[idx[f]]) a1++; else b1++; }
    if (a1 < 0.4 * a0 || b1 < 0.4 * b0) continue;
    for (const f of band) { const l = side[idx[f]] ? A : B; if (L[f] !== l) { L[f] = l; changed++; } }
  }
  return changed;
}

// Boundary anti-aliasing. Face labels make every boundary a zigzag of mesh edges, so on a coarse or uneven
// triangulation the rim between two parts shows triangle "teeth". Instead, each vertex near a boundary gets a
// label-weight vector (area fraction of its faces per part), the vectors are diffused for CUT_ITERS Jacobi steps
// inside a CUT_RINGS-vertex band, and the boundary is re-drawn as the iso-line where the two strongest labels tie
// (marching triangles). Faces it crosses are split along it, so the mesh gains vertices and faces; the surface itself
// is unchanged. A crossing is clamped to [CUT_T, 1-CUT_T] along its edge to avoid slivers. Faces at a junction of
// three parts get a centroid vertex. A face sharing an edge it would cut with a face that may not change (outside
// the mask) stays whole, so no T-junctions are made. mask: only these faces may change. Returns faces split; when
// it is not 0, S.pos/S.tri/S.G are new arrays (callers that display the mesh rebuild it).
const CUT_RINGS = 8, CUT_ITERS = 30, CUT_T = 0.15, CUT_SIGMA = 25;
export function smoothCut(S, mask = null) {
  const { pos, tri, nV, nF } = S, L = S.labels;
  const vfS = new Int32Array(nV + 1);
  for (let i = 0; i < tri.length; i++) vfS[tri[i] + 1]++;
  for (let v = 0; v < nV; v++) vfS[v + 1] += vfS[v];
  const vf = new Int32Array(tri.length), fill = vfS.slice(0, nV);
  for (let i = 0; i < tri.length; i++) vf[fill[tri[i]]++] = (i / 3) | 0;
  const ok = (f) => !mask || mask[f];
  // band: free vertices (every face around them may change) within CUT_RINGS rings of a mixed-label vertex
  const free = new Uint8Array(nV), ring = new Int8Array(nV).fill(-1);
  let front = [];
  for (let v = 0; v < nV; v++) {
    if (vfS[v] === vfS[v + 1]) continue;
    let fr = 1, mixed = 0; const l0 = L[vf[vfS[v]]];
    for (let k = vfS[v]; k < vfS[v + 1]; k++) { const f = vf[k]; if (!ok(f)) fr = 0; if (L[f] !== l0) mixed = 1; }
    free[v] = fr;
    if (fr && mixed) { ring[v] = 0; front.push(v); }
  }
  if (!front.length) return 0;
  const band = front.slice();
  for (let r = 1; r <= CUT_RINGS; r++) {
    const nx = [];
    for (const v of front) for (let k = vfS[v]; k < vfS[v + 1]; k++) for (let c = 0; c < 3; c++) {
      const u = tri[3 * vf[k] + c]; if (ring[u] < 0 && free[u]) { ring[u] = r; nx.push(u); }
    }
    band.push(...nx); front = nx;
  }
  const area = S.G.area, fixedW = new Map();
  const frac = (v) => {
    const m = new Map(); let t = 0;
    for (let k = vfS[v]; k < vfS[v + 1]; k++) { const f = vf[k], a = area[f] + 1e-12; m.set(L[f], (m.get(L[f]) || 0) + a); t += a; }
    for (const [l, w] of m) m.set(l, w / t);
    return m;
  };
  let W = new Map();
  for (const v of band) W.set(v, frac(v));
  const wOf = (v) => W.get(v) || fixedW.get(v) || (fixedW.set(v, frac(v)), fixedW.get(v));
  // vertex normals: diffusion between vertices whose normals differ by much more than CUT_SIGMA degrees is
  // weak, so a boundary lying on a real crease stays on it while one on a smooth surface gets straightened
  const vn = new Map(), G = S.G;
  const nOf = (v) => {
    let r = vn.get(v); if (r) return r;
    let x = 0, y = 0, z = 0;
    for (let k = vfS[v]; k < vfS[v + 1]; k++) { const f = vf[k], a = area[f]; x += G.nrm[3*f] * a; y += G.nrm[3*f+1] * a; z += G.nrm[3*f+2] * a; }
    const l = Math.hypot(x, y, z) || 1; r = [x / l, y / l, z / l]; vn.set(v, r); return r;
  };
  const kap = 1 - Math.cos(CUT_SIGMA * Math.PI / 180);
  const wt = (v, u) => { const a = nOf(v), b = nOf(u); return Math.exp(-(1 - (a[0]*b[0] + a[1]*b[1] + a[2]*b[2])) / kap); };
  const nb = band.map((v) => {
    const us = [], qs = [];
    for (let k = vfS[v]; k < vfS[v + 1]; k++) for (let c = 0; c < 3; c++) { const u = tri[3 * vf[k] + c]; if (u !== v) { us.push(u); qs.push(wt(v, u)); } }
    return [us, qs];
  });
  for (let it = 0; it < CUT_ITERS; it++) {
    const NW = new Map();
    for (let bi = 0; bi < band.length; bi++) {
      const v = band[bi], [us, qs] = nb[bi], acc = new Map(); let n = 0;
      for (let j = 0; j < us.length; j++) {
        const q = qs[j]; if (q < 1e-4) continue;
        for (const [l, w] of wOf(us[j])) acc.set(l, (acc.get(l) || 0) + q * w);
        n += q;
      }
      if (n < 1e-6) { NW.set(v, W.get(v)); continue; }
      const out = new Map();
      for (const [l, w] of W.get(v)) out.set(l, 0.5 * w);
      for (const [l, w] of acc) out.set(l, (out.get(l) || 0) + 0.5 * w / n);
      NW.set(v, out);
    }
    W = NW;
  }
  const arg = new Int32Array(nV).fill(-1);
  const argOf = (v) => {
    if (arg[v] >= 0) return arg[v];
    let best = 0, bw = -1; for (const [l, w] of wOf(v)) if (w > bw || (w === bw && l < best)) { bw = w; best = l; }
    return (arg[v] = best);
  };
  // faces that may be split: touch the band, are in the mask, are not degenerate
  const proc = new Uint8Array(nF);
  for (let f = 0; f < nF; f++) {
    const a = tri[3*f], b = tri[3*f+1], c = tri[3*f+2];
    if (ok(f) && a !== b && b !== c && c !== a && (ring[a] >= 0 || ring[b] >= 0 || ring[c] >= 0)) proc[f] = 1;
  }
  const facesOn = (u, v) => { const r = []; for (let k = vfS[u]; k < vfS[u + 1]; k++) { const g = vf[k]; if (tri[3*g] === v || tri[3*g+1] === v || tri[3*g+2] === v) r.push(g); } return r; };
  for (let changed = true; changed;) { // an edge is cut only if every face on it is split
    changed = false;
    for (let f = 0; f < nF; f++) if (proc[f]) for (let e = 0; e < 3 && proc[f]; e++) {
      const u = tri[3*f+e], v = tri[3*f+(e+1)%3];
      if (argOf(u) === argOf(v)) continue;
      for (const g of facesOn(u, v)) if (!proc[g]) { proc[f] = 0; changed = true; break; }
    }
  }
  const P = Array.from(pos), T = [], Lab = [], par = [], cut = new Map();
  const pt = (x, y, z) => { P.push(x, y, z); return P.length / 3 - 1; };
  const cutAt = (u, v) => {
    if (u > v) [u, v] = [v, u];
    const key = u * nV + v; let i = cut.get(key);
    if (i !== undefined) return i;
    const A = argOf(u), B = argOf(v), wu = wOf(u), wv = wOf(v);
    const du = (wu.get(A) || 0) - (wu.get(B) || 0), dv = (wv.get(A) || 0) - (wv.get(B) || 0);
    let t = du - dv > 1e-12 ? du / (du - dv) : 0.5;
    t = Math.min(1 - CUT_T, Math.max(CUT_T, t));
    i = pt(pos[3*u] + t * (pos[3*v] - pos[3*u]), pos[3*u+1] + t * (pos[3*v+1] - pos[3*u+1]), pos[3*u+2] + t * (pos[3*v+2] - pos[3*u+2]));
    cut.set(key, i); return i;
  };
  const d2 = (i, j) => (P[3*i]-P[3*j])**2 + (P[3*i+1]-P[3*j+1])**2 + (P[3*i+2]-P[3*j+2])**2;
  const tri3 = (a, b, c, l, f) => { T.push(a, b, c); Lab.push(l); par.push(f); };
  const quad = (a, b, c, d, l, f) => { if (d2(a, c) <= d2(b, d)) { tri3(a, b, c, l, f); tri3(a, c, d, l, f); } else { tri3(a, b, d, l, f); tri3(b, c, d, l, f); } };
  let split = 0;
  for (let f = 0; f < nF; f++) {
    let a = tri[3*f], b = tri[3*f+1], c = tri[3*f+2];
    if (!proc[f]) { tri3(a, b, c, L[f], f); continue; }
    let la = argOf(a), lb = argOf(b), lc = argOf(c);
    if (la === lb && lb === lc) { tri3(a, b, c, la, f); continue; }
    split++;
    if (la !== lb && lb !== lc && lc !== la) {
      const m = pt((pos[3*a] + pos[3*b] + pos[3*c]) / 3, (pos[3*a+1] + pos[3*b+1] + pos[3*c+1]) / 3, (pos[3*a+2] + pos[3*b+2] + pos[3*c+2]) / 3);
      const ab = cutAt(a, b), bc = cutAt(b, c), ca = cutAt(c, a);
      quad(a, ab, m, ca, la, f); quad(b, bc, m, ab, lb, f); quad(c, ca, m, bc, lc, f);
      continue;
    }
    // rotate so that c is the odd corner (la === lb)
    while (la !== lb) { [a, b, c] = [b, c, a]; [la, lb, lc] = [lb, lc, la]; }
    const p = cutAt(b, c), q = cutAt(c, a);
    tri3(p, c, q, lc, f); quad(a, b, p, q, la, f);
  }
  if (!split) return 0;
  const first = new Int32Array(nF).fill(-1);
  par.forEach((f, i) => { if (first[f] < 0) first[f] = i; });
  for (const p of S.parts) p.seeds = p.seeds.map((f) => first[f]).filter((f) => f >= 0);
  S.labels = Int32Array.from(Lab);
  setMesh(S, new Float32Array(P), Uint32Array.from(T));
  return split;
}

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

// ---------------------------------------------------------------- sessions (.split.json)
// v2 zlib-compresses labels so large meshes still fit the browser's localStorage quota; v1 files still load.
export function b64(b) { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
export function unb64(t) { const bin = atob(t), b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; }
// Labels, parts, replacement meshes and (after boundary smoothing) the cut mesh of a saved session.
// nF0: face count of the mesh as loaded; a session only fits the mesh it was made on. coarse (S.coarse): the face
// count before long edges were split and each face's parent, so a session saved before that refinement still loads.
export function decodeSession(txt, nF0, coarse = null) {
  const j = typeof txt === "string" ? JSON.parse(txt) : txt;
  const old = j.faces !== nF0 && coarse && j.faces === coarse.faces;
  if (j.faces !== nF0 && !old) throw new Error(`Session is for a mesh with ${j.faces} faces; this one has ${nF0}.`);
  let b = unb64(j.labels);
  if (j.version >= 2) b = unzlibSync(b);
  const mesh = j.mesh ? { pos: new Float32Array(unzlibSync(unb64(j.mesh.pos)).buffer), tri: new Uint32Array(unzlibSync(unb64(j.mesh.tri)).buffer) } : null;
  const reps = Object.entries(j.reps || {}).map(([id, r]) => ({ id, name: r.name, pos: new Float32Array(unzlibSync(unb64(r.pos)).buffer) }));
  let labels = new Int32Array(b.slice().buffer), parts = j.parts;
  if (old && !mesh) { // labels and seed faces are on the unrefined faces: carry them to their pieces
    const child = new Int32Array(coarse.faces).fill(-1);
    coarse.parent.forEach((p, f) => { if (child[p] < 0) child[p] = f; });
    labels = Int32Array.from(coarse.parent, (p) => labels[p]);
    parts = parts.map((p) => ({ ...p, seeds: (p.seeds || []).map((f) => child[f] ?? -1).filter((f) => f >= 0) }));
  }
  return { labels, parts, mesh, reps };
}

// reps: { id: { name, pos } } replacement meshes the parts use. cache: reused between calls so an autosave does not
// re-compress an unchanged cut mesh. After boundary smoothing the mesh differs from the file, so the session carries it.
export function encodeSession(S, reps = {}, cache = {}) {
  const z = (a) => b64(zlibSync(new Uint8Array(a.buffer.slice(0))));
  const R = {};
  for (const [id, r] of Object.entries(reps)) R[id] = { name: r.name, pos: z(r.pos) };
  const cut = S.tri !== S.mesh0[1];
  if (cut && cache.tri !== S.tri) { cache.tri = S.tri; cache.mesh = { pos: z(S.pos), tri: z(S.tri) }; }
  return JSON.stringify({ version: 2, file: S.name, faces: S.mesh0[1].length / 3, parts: S.parts, labels: z(S.labels), reps: R, mesh: cut ? cache.mesh : undefined });
}
