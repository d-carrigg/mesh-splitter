// Opening a model that is already split (a multi-part 3MF, or an OrcaSlicer object with several parts) keeps its
// parts instead of merging them into one mesh and auto-splitting it again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import * as core from "../app/core.js";

const xml = (t) => new DOMParser().parseFromString(t, "application/xml");

for (const name of ["bear", "robot"]) test(`${name}: its parts 3MF opens with the same parts, joined at the cuts`, () => {
  const file = new URL(`../examples/${name}/${name}_parts.3mf`, import.meta.url);
  const raw = core.parse3MF(readFileSync(file), xml);
  assert.ok(raw.groups.length > 1);
  const S = core.newSplit(`${name}_parts.3mf`, raw);
  const counts = core.partCounts(S);
  assert.equal(S.parts.length - 1, raw.groups.length);
  assert.equal(counts[0], 0, "no Unassigned faces");
  assert.deepEqual(S.parts.slice(1).map((p) => p.name), raw.groups.map((g) => g.name));
  for (let i = 1; i < S.parts.length; i++) assert.ok(counts[i] > 0, `${S.parts[i].name} has faces`);
  assert.ok(S.capsRemoved > 0, "the shared cut caps are removed");
  // nothing moves: every vertex is one of the file's
  const keys = new Set(); for (let i = 0; i < raw.pos.length; i += 3) keys.add(`${raw.pos[i]},${raw.pos[i+1]},${raw.pos[i+2]}`);
  for (let i = 0; i < S.pos.length; i += 3) if (!keys.has(`${S.pos[i]},${S.pos[i+1]},${S.pos[i+2]}`) && !S.refined) assert.fail("a vertex moved");
});

// The split as Mesh Splitter sends it to OrcaSlicer (each part closed over its cuts, in its original place), read back
// the way the plugin reads an object with several parts: the same faces in the same parts, as one surface again.
for (const name of ["bear", "robot"]) test(`${name}: a split sent to OrcaSlicer loads back with the same parts and faces`, () => {
  const ex = (f) => new URL(`../examples/${name}/${f}`, import.meta.url);
  const pos0 = core.parseSTL(readFileSync(ex(`${name}.stl`)));
  const S0 = core.newSplit(name, { pos: pos0, tri: core.soupIndex(pos0), source: { type: "stl" } });
  const d = core.decodeSession(readFileSync(ex(`${name}.split.json`), "utf8"), S0.nF, S0.coarse);
  if (d.mesh) core.setMesh(S0, d.mesh.pos, d.mesh.tri);
  S0.labels = d.labels; S0.parts = d.parts;
  const used = S0.parts.map((p, i) => i).filter((i) => i > 0 && core.partCounts(S0)[i] > 0);
  const soups = used.map((i) => ({ name: S0.parts[i].name, filament: S0.parts[i].filament, soup: core.closedPart(S0, i) }));
  const pos = Float32Array.from(soups.flatMap((s) => [...s.soup]));
  const S = core.newSplit(name, { pos, tri: core.soupIndex(pos), groups: soups.map((s) => ({ name: s.name, filament: s.filament, count: s.soup.length / 9 })), source: { type: "orca" } });
  assert.deepEqual(S.parts.slice(1).map((p) => [p.name, p.filament]), soups.map((s) => [s.name, s.filament]));
  assert.equal(S.G.shells, S0.G.shells, "the parts join along their cuts");
  const c0 = core.partCounts(S0), c = core.partCounts(S);
  assert.deepEqual([...c].slice(1), used.map((i) => c0[i]), "each part has exactly its own faces: every cut cap is gone");
});

test("one part or no groups: unchanged", () => {
  const pos = core.parseSTL(readFileSync(new URL("../examples/bear/bear.stl", import.meta.url)));
  const S = core.newSplit("bear.stl", { pos, tri: core.soupIndex(pos), groups: [{ name: "a", count: pos.length / 9 }], source: { type: "stl" } });
  assert.equal(S.parts.length, 1);
  assert.equal(S.capsRemoved, undefined);
});
