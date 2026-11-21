// Sessions (.split.json): save and load a split to keep editing it later.
import { zlibSync, unzlibSync } from "fflate";

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
