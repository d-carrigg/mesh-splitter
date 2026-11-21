#!/usr/bin/env node
// Mesh Splitter on the command line. Uses app/core.js, the same splitting code as the browser app and the
// OrcaSlicer plugin, so a split made here matches one made there with the same settings.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { DOMParser } from "@xmldom/xmldom";
import * as core from "../app/core.js";

const HELP = `Split a mesh into parts without opening the app.

Usage:
  mesh-splitter split MESH [method] [outputs] [options]

MESH is an .stl or .3mf file.

Method (pick one; default --auto):
  --auto [N]            auto split into N parts (2-32); without N the count is picked from the creases
  --shells              one part per separate shell
  --seeds FILE          grow parts from seed points (JSON, see below)
  --session FILE        apply a .split.json saved from the app (Export > Save session)

Outputs (default: MESH_parts.3mf next to MESH):
  -o, --out FILE        multi-part 3MF: one object, one part per split part with its filament slot
  --painted FILE        painted 3MF: one mesh, each face painted with its part's filament slot
  --stl DIR             one closed STL per part
  --merged FILE         all parts in one STL
  --save-session FILE   .split.json to open in the app and keep editing

Options:
  --crease DEG          crease step, the app's Crease slider (default ${core.DEFAULTS.step})
  --denoise N           concavity smoothing passes, the app's Denoise slider (default ${core.DEFAULTS.smooth})
  -q, --quiet           print nothing but errors
  -h, --help

Seeds file: a list of parts, each with seed points (x, y, z in the mesh's units) and/or face indices:
  [{ "name": "Head", "filament": 2, "points": [[0, 0, 40]] },
   { "name": "Body", "points": [[0, 0, 10], [0, 5, 0]] }]
Each point picks the nearest face. Parts without a filament get the next free slot.`;

const fail = (msg) => { console.error(`mesh-splitter: ${msg}`); process.exit(1); };

export function main(argv) {
  if (argv[0] === "split") argv = argv.slice(1);
  // --auto takes an optional count: a bare "--auto" followed by a non-number means "pick the count"
  const ai = argv.indexOf("--auto");
  if (ai >= 0 && !/^\d+$/.test(argv[ai + 1] ?? "")) argv = [...argv.slice(0, ai + 1), "0", ...argv.slice(ai + 1)];
  let a;
  try {
    a = parseArgs({
      args: argv, allowPositionals: true, options: {
        auto: { type: "string" }, shells: { type: "boolean" }, seeds: { type: "string" }, session: { type: "string" },
        out: { type: "string", short: "o" }, painted: { type: "string" }, stl: { type: "string" }, merged: { type: "string" },
        "save-session": { type: "string" }, crease: { type: "string" }, denoise: { type: "string" },
        quiet: { type: "boolean", short: "q" }, help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) { fail(`${e.message}\nRun with --help for usage.`); }
  const o = a.values;
  if (o.help || !a.positionals.length) { console.log(HELP); return; }
  if (a.positionals.length > 1) fail(`one mesh at a time (got ${a.positionals.join(", ")})`);
  const log = o.quiet ? () => {} : (...m) => console.log(...m);
  const methods = ["auto", "shells", "seeds", "session"].filter((k) => o[k] !== undefined);
  if (methods.length > 1) fail(`pick one method, not ${methods.map((m) => "--" + m).join(" and ")}`);
  const step = o.crease !== undefined ? +o.crease : core.DEFAULTS.step;
  const smooth = o.denoise !== undefined ? Math.round(+o.denoise) : core.DEFAULTS.smooth;
  if (!(step >= 0 && step <= 90)) fail("--crease must be a number of degrees from 0 to 90");
  if (!(smooth >= 0 && smooth <= 50)) fail("--denoise must be a whole number from 0 to 50");

  const k = +(o.auto ?? 0);
  if (k && (k < 2 || k > 32 || !Number.isInteger(k))) fail("--auto N must be a whole number from 2 to 32");
  const file = a.positionals[0];
  if (!fs.existsSync(file)) fail(`${file}: no such file`);
  const S = load(file);
  log(`${path.basename(file)}: ${S.nF.toLocaleString()} faces, ${S.G.shells} shell${S.G.shells > 1 ? "s" : ""}`);
  if (S.refined) log(`  split long edges: +${S.refined.toLocaleString()} faces, so the creases show`);
  if (S.flipped) log(`  turned ${S.flipped} inside-out shell${S.flipped > 1 ? "s" : ""} right side out`);

  const opts = { step, smooth };
  try {
    if (o.shells) core.splitShells(S);
    else if (o.seeds) seedSplit(S, JSON.parse(read(o.seeds, "utf8")), opts);
    else if (o.session) applySession(S, read(o.session, "utf8"), log);
    else core.autoSplit(S, +(o.auto ?? 0), opts);
  } catch (e) { fail(e.message); }

  const cnt = core.partCounts(S), used = S.parts.map((p, i) => [p, i]).filter(([, i]) => cnt[i] > 0);
  log(`${used.length} part${used.length > 1 ? "s" : ""}:`);
  for (const [p, i] of used) log(`  ${p.name.padEnd(16)} filament ${String(p.filament).padStart(2)}  ${cnt[i].toLocaleString()} faces`);

  const outs = ["out", "painted", "stl", "merged", "save-session"].some((k) => o[k] !== undefined);
  const base = path.join(path.dirname(file), S.name);
  write(o.out ?? (outs ? null : `${base}_parts.3mf`), () => core.parts3MF(S.name, soups(S, used)).out, log);
  write(o.painted, () => core.painted3MF(S.name, S, (f) => S.parts[S.labels[f]].filament, S.tri === S.mesh0[1] ? S.source : null), log);
  write(o.merged, () => core.stlBinary(concat(soups(S, used).map((p) => p.soup))), log);
  write(o["save-session"], () => core.encodeSession(S, S.reps), log);
  if (o.stl) {
    const names = new Set();
    for (const p of soups(S, used)) {
      let nm = `${core.safeName(S.name)}_${core.safeName(p.name)}`; while (names.has(nm.toLowerCase())) nm += "_"; names.add(nm.toLowerCase()); // case-insensitive file systems
      write(path.join(o.stl, `${nm}.stl`), () => core.stlBinary(p.soup), log);
    }
  }
}

function read(f, enc) { try { return fs.readFileSync(f, enc); } catch (e) { fail(`${f}: ${e.code === "ENOENT" ? "no such file" : e.message}`); } }

function load(file) {
  const buf = read(file), ext = path.extname(file).toLowerCase();
  let raw;
  try {
    if (ext === ".stl") { const pos = core.parseSTL(buf); raw = { pos, tri: core.soupIndex(pos), source: { type: "stl" } }; }
    else if (ext === ".3mf") raw = core.parse3MF(buf, (t) => new DOMParser().parseFromString(t, "application/xml"));
    else fail(`${file}: only .stl and .3mf are supported`);
  } catch (e) { fail(`${file}: ${e.message}`); }
  return core.newSplit(path.basename(file), raw);
}

// The face nearest to a point: distance to the triangle itself, not its center, so a point on a big flat face
// (CAD-style meshes with long thin triangles) doesn't pick a small face nearby whose center happens to be closer.
function nearestFace(S, p) {
  let best = -1, bd = Infinity;
  for (let f = 0; f < S.nF; f++) {
    const d = triDist2(p, ...[0, 1, 2].map((c) => { const v = S.tri[3 * f + c]; return [S.pos[3 * v], S.pos[3 * v + 1], S.pos[3 * v + 2]]; }));
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}
// Squared distance from point p to triangle abc (closest-point regions, Ericson, Real-Time Collision Detection 5.1.5).
function triDist2(p, a, b, c) {
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]], dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const at = (o, u, s, w, t) => [o[0] + u[0] * s + w[0] * t, o[1] + u[1] * s + w[1] * t, o[2] + u[2] * s + w[2] * t];
  const d2 = (q) => { const d = sub(p, q); return dot(d, d); };
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2_ = dot(ac, ap);
  if (d1 <= 0 && d2_ <= 0) return d2(a);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return d2(b);
  const vc = d1 * d4 - d3 * d2_;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return d2(at(a, ab, d1 / (d1 - d3), ac, 0));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return d2(c);
  const vb = d5 * d2_ - d1 * d6;
  if (vb <= 0 && d2_ >= 0 && d6 <= 0) return d2(at(a, ab, 0, ac, d2_ / (d2_ - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return d2(at(b, sub(c, b), w, ab, 0)); }
  const den = 1 / (va + vb + vc);
  return d2(at(a, ab, vb * den, ac, vc * den));
}

function seedSplit(S, spec, opts) {
  const list = Array.isArray(spec) ? spec : spec?.parts;
  if (!Array.isArray(list) || !list.length) throw new Error("seeds file: expected a list of parts");
  const taken = new Set(list.map((q) => q.filament).filter((f) => f !== undefined)); // explicit slots first
  for (const [n, q] of list.entries()) {
    const seeds = [];
    for (const pt of q.points || []) {
      if (!Array.isArray(pt) || pt.length !== 3 || pt.some((v) => !Number.isFinite(+v))) throw new Error(`seeds file, part ${n + 1}: a point must be [x, y, z]`);
      seeds.push(nearestFace(S, pt.map(Number)));
    }
    for (const f of q.faces || []) {
      if (!Number.isInteger(f) || f < 0 || f >= S.nF) throw new Error(`seeds file, part ${n + 1}: face ${f} is not in the mesh (0-${S.nF - 1})`);
      seeds.push(f);
    }
    if (!seeds.length) throw new Error(`seeds file, part ${n + 1}: no points or faces`);
    const o = { seeds: [...new Set(seeds)] };
    if (q.name) o.name = String(q.name);
    if (q.filament !== undefined) {
      if (!Number.isInteger(q.filament) || q.filament < 1 || q.filament > 16) throw new Error(`seeds file, part ${n + 1}: filament must be 1-16`);
      o.filament = q.filament;
    } else {
      let f = 2; while (f < 16 && (taken.has(f) || S.parts.some((p, i) => i > 0 && p.filament === f))) f++;
      o.filament = f;
    }
    S.parts.push(core.newPart(S, o));
  }
  core.segmentFromSeeds(S, opts);
  core.dropEmptyParts(S);
}

function applySession(S, txt, log) {
  const d = core.decodeSession(txt, S.mesh0[1].length / 3, S.coarse);
  S.labels = d.labels; S.parts = d.parts; S.reps = Object.fromEntries(d.reps.map((r) => [r.id, r]));
  if (d.mesh) core.setMesh(S, d.mesh.pos, d.mesh.tri);
  const moved = S.parts.filter((p, i) => i > 0 && (p.rep || (p.xf && !(p.xf.s.every((v) => v === 1) && p.xf.r.every((v) => v === 0) && p.xf.t.every((v) => v === 0)))));
  if (moved.length) log(`Note: ${moved.map((p) => p.name).join(", ")} moved or replaced in the app; written here in the original position and shape.`);
}

// Closed triangle soup per part: its faces plus caps over the cut openings (a recess gets a skin, see core.pocketShell).
function soups(S, used) {
  const pockets = new Map();
  return used.map(([p, i]) => ({ name: p.name, filament: p.filament, soup: core.closedPart(S, i, pockets) }));
}
function concat(arrs) { const v = new Float32Array(arrs.reduce((n, a) => n + a.length, 0)); let o = 0; for (const a of arrs) { v.set(a, o); o += a.length; } return v; }

function write(file, make, log) {
  if (!file) return;
  try {
    const data = make();
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, data);
  } catch (e) { fail(`${file}: ${e.message}`); }
  log(`Wrote ${file}`);
}

main(process.argv.slice(2));
