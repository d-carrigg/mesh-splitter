// Splitting algorithms: watershed growth from seeds, auto split, one part per shell.
import { DEFAULTS, Heap, components, ensureBarrier } from "./graph.js";
import { newPart, dropEmptyParts, partCounts } from "./parts.js";
import { snapCreases, smoothCut } from "./boundary.js";

// ---------------------------------------------------------------- algorithms
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
