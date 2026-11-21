#!/usr/bin/env node
// Golden-output test for the splitting code (app/core.js). Runs the command line on the example meshes with every
// method and output, calls the core functions the app uses but the command line doesn't, hashes everything they
// produce, and compares the hashes with test/golden.json. A refactor that changes no behavior keeps every hash.
//   node test/golden.mjs            check against test/golden.json
//   node test/golden.mjs --update   rewrite test/golden.json (only when an output is meant to change)
// 3MFs are zips with timestamps, so each file inside is hashed, not the zip itself.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import * as core from "../app/core.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const goldenFile = path.join(root, "test", "golden.json");
const update = process.argv.includes("--update");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mesh-splitter-golden-"));
const ex = (p) => path.join(root, "examples", p);
const out = (p) => path.join(tmp, p);
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex").slice(0, 16);

// Each case: command line arguments (the mesh first) and the outputs it writes, relative to tmp.
// Order matters: a later case can read an earlier case's output.
const CASES = {
  "robot auto": [[ex("robot/robot.stl"), "--auto", "-o", out("robot_auto.3mf"), "--report", out("robot_auto.json")]],
  "robot auto 12, 4 slots": [[ex("robot/robot.stl"), "--auto", "12", "--filaments", "4", "-o", out("robot_f4.3mf")]],
  "robot auto 16, every output": [[ex("robot/robot.stl"), "--auto", "16", "-o", out("robot16.3mf"), "--painted", out("robot16_painted.3mf"),
    "--stl", out("robot16_stl"), "--merged", out("robot16_merged.stl"), "--save-session", out("robot16.split.json"), "--report", out("robot16.json")]],
  "robot seeds, crease/denoise": [[ex("robot/robot.stl"), "--seeds", ex("robot/robot.seeds.json"), "--crease", "5", "--denoise", "2", "-o", out("robot_seeds.3mf")]],
  "robot merge": [[ex("robot/robot.stl"), "--auto", "6", "--merge", "Joined=Part 1,Part 2", "-o", out("robot_merge.3mf"), "--report", out("robot_merge.json")]],
  "rocket auto (recesses)": [[ex("rocket/rocket.stl"), "-o", out("rocket.3mf"), "--stl", out("rocket_stl"), "--report", out("rocket.json")]],
  "rocket session": [[ex("rocket/rocket.stl"), "--session", ex("rocket/rocket.split.json"), "-o", out("rocket_session.3mf")]],
  "bear seeds": [[ex("bear/bear.stl"), "--seeds", ex("bear/bear.seeds.json"), "-o", out("bear.3mf"), "--painted", out("bear_painted.3mf"), "--save-session", out("bear.split.json")]],
  "bear session": [[ex("bear/bear.stl"), "--session", ex("bear/bear.split.json"), "-o", out("bear_session.3mf"), "--merged", out("bear_session_merged.stl")]],
  "shells (bear and rocket side by side)": [[out("two_shells.stl"), "--shells", "-o", out("two_shells.3mf"), "--stl", out("two_shells_stl"), "--report", out("two_shells.json")]],
  "inside-out input (bear, flipped)": [[out("bear_inside_out.stl"), "--seeds", ex("bear/bear.seeds.json"), "-o", out("bear_inside_out.3mf")]],
  "3MF input (robot parts)": [[ex("robot/robot_parts.3mf"), "--shells", "-o", out("robot_from3mf.3mf"), "--painted", out("robot_from3mf_painted.3mf")]],
};

function hashPath(p) {
  if (fs.statSync(p).isDirectory()) return Object.fromEntries(fs.readdirSync(p).sort().map((f) => [f, hashPath(path.join(p, f))]));
  const b = fs.readFileSync(p);
  if (p.endsWith(".3mf")) return Object.fromEntries(Object.entries(unzipSync(b)).sort(([a], [c]) => a.localeCompare(c)).map(([n, d]) => [n, sha(d)]));
  return sha(b);
}

// The bear with every triangle's winding reversed, so the inside-out repair runs.
fs.writeFileSync(out("bear_inside_out.stl"), core.stlBinary(core.reverseSoup(core.parseSTL(fs.readFileSync(ex("bear/bear.stl"))))));

// Two separate shells in one STL: the bear, and the rocket moved 200 mm along X.
{
  const a = core.parseSTL(fs.readFileSync(ex("bear/bear.stl"))), b = core.parseSTL(fs.readFileSync(ex("rocket/rocket.stl")));
  const v = new Float32Array(a.length + b.length); v.set(a); v.set(b, a.length);
  for (let i = a.length; i < v.length; i += 3) v[i] += 200;
  fs.writeFileSync(out("two_shells.stl"), core.stlBinary(v));
}

const got = {};
for (const [name, [args]] of Object.entries(CASES)) {
  const r = spawnSync(process.execPath, [path.join(root, "cli", "split.mjs"), "split", ...args], { encoding: "utf8" });
  if (r.status !== 0) { console.error(`${name}: the command line failed\n${r.stderr}`); process.exit(1); }
  const log = (r.stdout + r.stderr).split(tmp).join("<tmp>").split(root).join("<root>");
  const files = {};
  for (let i = 1; i < args.length; i++) if (typeof args[i] === "string" && args[i].startsWith(tmp)) files[path.relative(tmp, args[i])] = hashPath(args[i]);
  got[name] = { log: sha(log), files };
}

// Core functions the app calls directly that the command line doesn't reach.
{
  const S = core.newSplit("robot.stl", (() => { const pos = core.parseSTL(fs.readFileSync(ex("robot/robot.stl"))); return { pos, tri: core.soupIndex(pos), source: { type: "stl" } }; })());
  core.autoSplit(S, 8, { step: core.DEFAULTS.step, smooth: core.DEFAULTS.smooth });
  const m = core.meshOf(S, (l) => l === 1);
  const d = {
    exports: sha(Object.keys(core).sort().join(",")),
    meshOf: sha(JSON.stringify(m, (k, v) => (v instanceof Map ? [...v] : v))),
    soupVolume: core.soupVolume(core.closedPart(S, 1)).toFixed(6),
    reverseSoup: sha(new Uint8Array(core.reverseSoup(core.closedPart(S, 2)).buffer)),
    paintCode: [1, 2, 3, 4, 8, 16].map(core.paintCode).join(","),
    snapCreases: core.snapCreases(S, null, 3),
    smoothCut: core.smoothCut(S),
    labelsAfterCleanup: sha(new Uint8Array(S.labels.buffer)),
    meshAfterCleanup: sha(new Uint8Array(S.pos.buffer)) + sha(new Uint8Array(S.tri.buffer)),
    session: sha(core.encodeSession(S)),
    sessionRoundTrip: sha(new Uint8Array(core.decodeSession(core.encodeSession(S), S.mesh0[1].length / 3).labels.buffer)),
  };
  got["core functions"] = d;
}

fs.rmSync(tmp, { recursive: true, force: true });
if (update) { fs.writeFileSync(goldenFile, JSON.stringify(got, null, 1) + "\n"); console.log(`Wrote ${path.relative(root, goldenFile)}`); process.exit(0); }

const want = JSON.parse(fs.readFileSync(goldenFile, "utf8"));
const diffs = [];
(function cmp(a, b, at) {
  if (typeof a === "object" && a && typeof b === "object" && b) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) cmp(a[k], b[k], at ? `${at} > ${k}` : k);
  } else if (a !== b) diffs.push(`${at}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
})(got, want, "");
if (diffs.length) { console.error(`${diffs.length} output(s) changed:\n  ` + diffs.join("\n  ")); process.exit(1); }
console.log(`All outputs match test/golden.json (${Object.keys(got).length} cases).`);
