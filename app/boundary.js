// Boundary clean-up after a split: crease snapping (minimum cut) and smoothing the cut line.
import { DEFAULTS, ensureBarrier } from "./graph.js";
import { setMesh } from "./mesh.js";

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
