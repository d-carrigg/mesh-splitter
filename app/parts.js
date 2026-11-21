// Parts of a split: colors, new parts, dropping empty parts, faces per part.
export const PALETTE = ["#e6194b","#3cb44b","#4363d8","#f58231","#911eb4","#42d4f4","#f032e6","#bfef45",
                        "#fabed4","#469990","#dcbeff","#9a6324","#fffac8","#800000","#aaffc3","#000075"];
export const UNASSIGNED_COLOR = "#9aa0a8";

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
