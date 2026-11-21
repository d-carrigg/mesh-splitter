// The face graph (faces linked across shared edges), shells, the concavity barrier, and a min-heap.
// Options: step = crease step (deg, the app's "Crease" slider), smooth = concavity smoothing passes ("Denoise").
export const DEFAULTS = { step: 2, smooth: 4 };
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

// ---------------------------------------------------------------- concavity barrier
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
