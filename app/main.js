import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { zipSync } from "fflate";
import * as core from "./core.js";
import { PALETTE, UNASSIGNED_COLOR, weld, soupIndex, paintCode, stlBinary, safeName as safe } from "./core.js";

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const $ = (id) => document.getElementById(id);
const ICONS = {
  orbit: '<path d="M16.5 7.5C15.6 4.2 14 2 12 2 9.2 2 7 6.5 7 12s2.2 10 5 10c.3 0 .7-.1 1-.2"/><path d="m15.2 13.7 3.8 1.9-1.9 3.8"/><path d="M19 15.6c-1.8.9-4.3 1.4-7 1.4-5.5 0-10-2.2-10-5s4.5-5 10-5c4.8 0 8.9 1.7 9.8 4"/>',
  seed: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  fill: '<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"/><path d="m5 2 5 5"/><path d="M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"/>',
  brush: '<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>',
  pick: '<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>',
  open: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  redo: '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7l3 2.7"/>',
  frame: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  merge: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
  eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.9 4.24A9 9 0 0 1 12 4c6.5 0 10 8 10 8a18 18 0 0 1-2.16 3.19"/><path d="M6.6 6.6A13.5 13.5 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="m2 2 20 20"/>',
  solo: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  segment: '<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.17-2.87L3 3"/><path d="m15 9 6-6"/>',
  smooth: '<path d="M2 12c2-5 4-5 6 0s4 5 6 0 4-5 6 0"/>',
  shells: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
  auto: '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9"/>',
  palette: '<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1a1.6 1.6 0 0 1 1.7-1.7h2c3 0 5.5-2.5 5.5-5.5C22 6 17.5 2 12 2z"/>',
  package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  replace: '<path d="M21 3v5h-5"/><path d="M3 21v-5h5"/><path d="M20.5 8A9 9 0 0 0 4.6 6.6"/><path d="M3.5 16a9 9 0 0 0 15.9 1.4"/>',
  sparkle: '<path d="M9.94 14.06 4 20M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1"/><circle cx="12" cy="12" r="2.5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  droplet: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5S5 13 5 15a7 7 0 0 0 7 7z"/>',
  text: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  scale: '<path d="M21 3h-6M21 3v6M21 3l-7 7"/><path d="M3 21h6M3 21v-6M3 21l7-7"/>',
  reach: '<path d="M4 20 12 12"/><path d="M12 12l6-6"/><path d="M14 5h5v5"/><circle cx="4" cy="20" r="1.5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  unlink: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/><path d="M3 3l18 18"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  joint: '<path d="M12 2v20" stroke-dasharray="2 2"/><path d="M17 11.5c2.5.6 4 1.5 4 2.5 0 2.2-4 4-9 4s-9-1.8-9-4c0-1.5 1.8-2.8 4.5-3.5"/><path d="m14 9 3 2.5-3 2.5"/>',
  move: '<path d="M12 2v20M2 12h20"/><path d="m9 5 3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/>',
  load: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
};
const icon = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;

// ---------------------------------------------------------------- state
const S = {
  name: "", source: null,          // {type:'stl'} | {type:'3mf', files, meshes:[{file,objectId,triStart,triCount}]}
  pos: null, tri: null, nF: 0, nV: 0,
  G: null,                         // face graph
  labels: null,                    // Int32Array part index per face
  parts: [],                       // {name,color,filament,seeds:[face],visible}
  active: 0, tool: "seed", hist: { past: [], future: [] },
};

// ---------------------------------------------------------------- three setup
const view = $("view");
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio);
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x5C5C63);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 1.6); camera.add(key); key.position.set(1, 2, 3);
scene.add(camera);
const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.0, side: THREE.DoubleSide });
let mesh = null, seedGroup = new THREE.Group(), brushRing = null;
scene.add(seedGroup);

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h); camera.aspect = w / h;
  if (camera.view?.enabled) camera.setViewOffset(w, h, camera.view.offsetX, 0, w, h);
  camera.updateProjectionMatrix(); render();
}
function render() { renderer.render(scene, camera); }
controls.addEventListener("change", render);
window.addEventListener("resize", resize);

// ---------------------------------------------------------------- loading
function busy(on) { $("busy").style.display = on ? "flex" : "none"; }
function later(fn) { busy(true); setTimeout(() => { try { fn(); } catch (e) { console.error(e); alert(e.message); } finally { busy(false); } }, 30); }

async function loadArrayBuffer(name, buf) {
  const ext = name.toLowerCase().split(".").pop();
  let raw;
  if (ext === "stl") { const pos = core.parseSTL(buf); raw = { pos, tri: soupIndex(pos), source: { type: "stl" } }; }
  else if (ext === "3mf") raw = parse3MF(buf);
  else throw new Error("Unsupported file type: " + ext);
  loadRaw(name, raw);
}
// raw = { pos, tri, source }: also the entry point for meshes handed over by the OrcaSlicer plugin
function loadRaw(name, raw) {
  Object.assign(S, core.newSplit(name, raw), { hist: { past: [], future: [] } });
  buildMesh();
  updatePlate();
  frame();
  refreshUI();
  const bb = S.G.bbox;
  $("fileName").textContent = name; $("fileBtn").title = `${name}: open another model, recent files, sessions`;
  $("fileInfo").textContent = `${S.nF.toLocaleString()} faces · ${S.G.shells} shell${S.G.shells > 1 ? "s" : ""} · ` +
    `${(bb[3]-bb[0]).toFixed(0)}×${(bb[4]-bb[1]).toFixed(0)}×${(bb[5]-bb[2]).toFixed(0)} mm`;
  $("drop").style.display = "none";
  $("brushR").max = (S.G.diag * 0.15).toFixed(1);
  if (+$("brushR").value > +$("brushR").max) $("brushR").value = (S.G.diag * 0.02).toFixed(1);
  syncSliders();
  lastActive = -1;
  if (!restoreAutosave() && S.nF >= 200) { autoSplit(0, true); S.hist = { past: [], future: [] }; refreshUI(); }
  const fixes = [S.refined && `split long edges (+${S.refined.toLocaleString()} faces) so creases show`, S.flipped && `turned ${S.flipped} inside-out shell${S.flipped > 1 ? "s" : ""} right side out`].filter(Boolean);
  if (fixes.length) status(`${$("status").textContent} · On open: ${fixes.join("; ")}`);
}

// The splitting algorithm lives in core.js (shared with the command line); these wrap it with the UI's
// settings, undo and display.
const parse3MF = (buf) => core.parse3MF(buf, (t) => new DOMParser().parseFromString(t, "application/xml"));
const creaseStep = () => +$("lambda").value;
const smoothIters = () => +$("smooth").value;
const grow = (sources, mask, step) => core.grow(S.G, sources, mask, step, smoothIters());
const meshChanged = (tri0) => { if (S.tri !== tri0) buildMesh(); }; // boundary smoothing replaced the mesh

// opts.snap: undo snapshot to push instead of the current state; opts.only: re-grow just these parts
// (and Unassigned) from their seeds, leaving every other part as it is.
function segmentFromSeeds(opts = {}) {
  const snap = opts.snap || snapshot(), tri0 = S.tri;
  let r;
  try { r = core.segmentFromSeeds(S, { only: opts.only, step: creaseStep(), smooth: smoothIters() }); } catch (e) { alert(e.message); return; }
  pushUndo(snap); meshChanged(tri0);
  afterEdit(`Segmented ${r.faces.toLocaleString()} faces into ${r.parts} part(s)`);
}

function autoSplit(k, scopeAll = false) {
  const scope = !scopeAll && $("autoScope").checked ? S.active : -1;
  const snap = snapshot(), tri0 = S.tri;
  let n;
  try { n = core.autoSplit(S, k, { scope, step: creaseStep(), smooth: smoothIters() }); } catch (e) { alert(e.message); return; }
  pushUndo(snap); meshChanged(tri0);
  afterEdit(`Auto split into ${n} part${n === 1 ? "" : "s"}`);
}

function splitShells() {
  const snap = snapshot();
  try { core.splitShells(S); } catch (e) { alert(e.message); return; }
  pushUndo(snap);
  afterEdit(`Split into ${S.parts.length - 1} shell part(s)`);
}

// Flood within the clicked face's part, stopping at concave creases sharper than the angle.
function fillFrom(f0) {
  const G = S.G, from = S.labels[f0], T = +$("fillAng").value;
  let to = S.active;
  pushUndo();
  if (to === from) { S.parts.push(newPart()); to = S.parts.length - 1; S.active = to; }
  const seen = new Uint8Array(S.nF), stack = [f0]; seen[f0] = 1; let n = 0;
  while (stack.length) {
    const f = stack.pop(); S.labels[f] = to; n++;
    for (let k = G.adjS[f]; k < G.adjS[f + 1]; k++) {
      const g = G.adjN[k], e = G.adjE[k];
      if (seen[g] || S.labels[g] !== from) continue;
      if (G.concave[e] && G.theta[e] > T) continue;
      seen[g] = 1; stack.push(g);
    }
  }
  dropEmptyParts();
  afterEdit(`Filled ${n.toLocaleString()} faces into ${S.parts[S.active].name}`);
}

// Brush: faces connected to the hit face whose centroid is within r of the hit point.
function brushAt(f0, p, to) {
  const G = S.G, r2 = (+$("brushR").value) ** 2, stack = [f0], seen = new Set([f0]);
  let changed = false;
  while (stack.length) {
    const f = stack.pop();
    if (S.labels[f] !== to) { S.labels[f] = to; changed = true; }
    for (let k = G.adjS[f]; k < G.adjS[f + 1]; k++) {
      const g = G.adjN[k]; if (seen.has(g)) continue; seen.add(g);
      const dx = G.cen[3*g]-p.x, dy = G.cen[3*g+1]-p.y, dz = G.cen[3*g+2]-p.z;
      if (dx*dx + dy*dy + dz*dz <= r2) stack.push(g);
    }
  }
  return changed;
}

// ---------------------------------------------------------------- parts
const newPart = (o = {}) => core.newPart(S, o);
const dropEmptyParts = () => core.dropEmptyParts(S);
const partCounts = () => core.partCounts(S);

function snapshot() { return { labels: S.labels.slice(), parts: JSON.parse(JSON.stringify(S.parts)), keys: S.parts.map(rowKey), active: S.active, mesh: [S.pos, S.tri, S.G] }; }
function pushUndo(snap = snapshot()) {
  S.hist.past.push(snap); S.hist.future = [];
  if (S.hist.past.length > 40) S.hist.past.shift();
}
function travel(from, to, msg) {
  const u = from.pop(); if (!u) return;
  to.push(snapshot());
  S.labels = u.labels; S.parts = u.parts; S.active = u.active;
  u.keys?.forEach((k, i) => rowKeys.set(u.parts[i], k)); // undo/redo keeps each part's row, so only real changes animate
  if (u.mesh && u.mesh[1] !== S.tri) setMesh(...u.mesh); // undo/redo across a boundary smoothing
  afterEdit(msg);
}
const undo = () => { closeFlow(); travel(S.hist.past, S.hist.future, "Undone"); };
const redo = () => { closeFlow(); travel(S.hist.future, S.hist.past, "Redone"); };

function afterEdit(msg) { updateColors(); applyXf(); updateVisibility(); syncReps(); drawSeeds(); refreshUI(); autosave(); if (msg) status(msg); }

// Unassigned faces (one connected patch from f0, or all) go to the parts touching them, grown from the border.
function fillUnassigned(f0 = -1) {
  const G = S.G, mask = new Uint8Array(S.nF);
  if (f0 >= 0) { const st = [f0]; mask[f0] = 1; while (st.length) { const f = st.pop(); for (let k = G.adjS[f]; k < G.adjS[f + 1]; k++) { const g = G.adjN[k]; if (!mask[g] && S.labels[g] === 0) { mask[g] = 1; st.push(g); } } } }
  else for (let f = 0; f < S.nF; f++) if (S.labels[f] === 0) mask[f] = 1;
  const src = [];
  for (let f = 0; f < S.nF; f++) if (mask[f]) for (let k = G.adjS[f]; k < G.adjS[f + 1]; k++) { const l = S.labels[G.adjN[k]]; if (l > 0) src.push([f, l]); }
  if (!src.length) { status("Nothing touching it to fill from"); return; }
  pushUndo();
  const lab = grow(src, mask, creaseStep()).lab;
  let n = 0; for (let f = 0; f < S.nF; f++) if (mask[f] && lab[f] > 0) { S.labels[f] = lab[f]; n++; }
  afterEdit(`Filled ${n.toLocaleString()} unassigned faces into the parts around them`);
}

// Deleting a part hands its faces to the touching parts (grown from the shared border, so a part touching
// two others splits along its creases). Touching only Unassigned, or a separate shell: nearest part.
function deletePart(i) {
  if (i <= 0) return;
  pushUndo();
  const G = S.G, mask = new Uint8Array(S.nF), src = [], srcU = [];
  let n = 0, cx = 0, cy = 0, cz = 0;
  for (let f = 0; f < S.nF; f++) if (S.labels[f] === i) { mask[f] = 1; n++; cx += G.cen[3*f]; cy += G.cen[3*f+1]; cz += G.cen[3*f+2]; }
  for (let f = 0; f < S.nF; f++) if (mask[f]) for (let k = G.adjS[f]; k < G.adjS[f + 1]; k++) {
    const g = G.adjN[k], l = S.labels[g]; if (l === i) continue;
    (l > 0 ? src : srcU).push([f, l]);
  }
  let to = src.length ? src : srcU;
  if (!src.length && n) { // no touching part: nearest face of another part
    cx /= n; cy /= n; cz /= n; let best = -1, bd = Infinity;
    for (let f = 0; f < S.nF; f++) { const l = S.labels[f]; if (l <= 0 || l === i) continue;
      const d = (G.cen[3*f]-cx)**2 + (G.cen[3*f+1]-cy)**2 + (G.cen[3*f+2]-cz)**2; if (d < bd) { bd = d; best = l; } }
    if (best > 0) to = [[[...mask.keys()].find((f) => mask[f]), best]];
  }
  if (n && to.length) {
    const lab = grow(to, mask, creaseStep()).lab;
    for (let f = 0; f < S.nF; f++) if (mask[f]) S.labels[f] = lab[f] >= 0 ? lab[f] : 0;
  } else for (let f = 0; f < S.nF; f++) if (mask[f]) S.labels[f] = 0;
  const got = new Map(); for (let f = 0; f < S.nF; f++) if (mask[f]) got.set(S.labels[f], (got.get(S.labels[f]) || 0) + 1);
  const into = [...got].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  for (let f = 0; f < S.nF; f++) { const l = S.labels[f]; if (l > i) S.labels[f] = l - 1; }
  const [p] = S.parts.splice(i, 1);
  S.active = into > i ? into - 1 : into;
  afterEdit(into > 0 ? `Deleted ${p.name}, merged into ${S.parts[S.active].name}` : `Deleted ${p.name}`);
}
// ---------------------------------------------------------------- delete geometry / close holes
// Delete geometry takes a part's faces out of the model itself (the merge-delete above keeps them). Where it touched
// other parts it leaves holes in them; with `close` on (the default) each hole gets a patch that follows the surface
// around it (patchRings, as Fill uses), made of real faces of the part around the hole. closeHoles does the same for
// holes already in the mesh, so a hole left open can be closed later.
function clearMeshCaches() { twinCache = { key: null, map: null }; loopCache.clear(); patchCache.clear(); pocketCache.clear(); healCache.clear(); }
// Holes: boundary loops of the whole mesh (edges with one face), as [{ lp, own }] with own the part with most of its edges.
function meshHoles() {
  const m = meshOf(() => true); if (!m) return [];
  const tw = twinLabels(fullHash()), nV = S.nV;
  return m.loopList.map((lp) => {
    const c = new Map(); for (const [a, b] of lp) { const l = tw.get(a * nV + b); c.set(l, (c.get(l) || 0) + 1); }
    return { lp, own: [...c].sort((x, y) => y[1] - x[1])[0][0] };
  });
}
// Close holes with new faces of the part around each. which(hole) picks the holes. Returns the number closed.
function closeHoleFaces(which = () => true) {
  const holes = meshHoles().filter(which); if (!holes.length) return 0;
  const hash = fullHash(), P = Array.from(S.pos), T = Array.from(S.tri), L = Array.from(S.labels);
  for (const { lp, own } of holes) {
    const at = new Map(), keyOf = (x, y, z) => `${x},${y},${z}`;
    for (const [a] of lp) at.set(keyOf(S.pos[3*a], S.pos[3*a+1], S.pos[3*a+2]), a);
    const ring0 = new Float32Array(3 * lp.length); lp.forEach(([a], j) => { ring0[3*j] = S.pos[3*a]; ring0[3*j+1] = S.pos[3*a+1]; ring0[3*j+2] = S.pos[3*a+2]; });
    const R = patchRings(lp, own > 0 ? own : -1, hash), out = [];
    ringTris([ring0, ...R.rings], R.c, false, out);
    const F = Float32Array.from(out), vid = (o) => { // loop points keep their vertex, so the patch is joined to the part
      const k = keyOf(F[o], F[o+1], F[o+2]); let v = at.get(k);
      if (v === undefined) { v = P.length / 3; P.push(F[o], F[o+1], F[o+2]); at.set(k, v); }
      return v;
    };
    for (let o = 0; o < F.length; o += 9) {
      const a = vid(o), b = vid(o + 3), c = vid(o + 6); if (a === b || b === c || a === c) continue;
      T.push(a, b, c); L.push(Math.max(0, own));
    }
  }
  setMesh(Float32Array.from(P), Uint32Array.from(T)); S.labels = Int32Array.from(L); clearMeshCaches();
  return holes.length;
}
function closeHoles(i = -1) { // i > 0: only the holes in part i
  const before = snapshot(), n = closeHoleFaces((h) => i <= 0 || h.own === i);
  if (!n) { status(i > 0 ? `${S.parts[i].name} has no holes` : "No holes in the model"); return; }
  pushUndo(before);
  afterEdit(`Closed ${n} hole${n > 1 ? "s" : ""}${i > 0 ? ` in ${S.parts[i].name}` : ""}`);
}
const holesIn = (i) => (S.G ? meshHoles().filter((h) => i < 0 || h.own === i).length : 0);
function deleteGeometry(js, close = true) {
  js = [...new Set(js)].filter((j) => j > 0 && S.parts[j]);
  if (!js.length) return;
  const gone = new Set(js), keep = []; for (let f = 0; f < S.nF; f++) if (!gone.has(S.labels[f])) keep.push(f);
  if (!keep.length) { status("Can't delete every part: nothing would be left"); return; }
  const before = snapshot(), names = js.map((j) => S.parts[j].name);
  // the deleted faces' vertices: a hole through one of them is a hole the delete opened
  const rim = new Set(); for (let f = 0; f < S.nF; f++) if (gone.has(S.labels[f])) for (let c = 0; c < 3; c++) rim.add(S.tri[3*f+c]);
  // compact the kept faces and their vertices; part indexes shift down past the deleted ones
  const vmap = new Int32Array(S.nV).fill(-1), P = [], T = [], newF = new Int32Array(S.nF).fill(-1), shift = new Int32Array(S.parts.length);
  for (let l = 0, d = 0; l < S.parts.length; l++) { if (gone.has(l)) { d++; shift[l] = -1; } else shift[l] = l - d; }
  const rimNew = new Set();
  keep.forEach((f, k) => {
    newF[f] = k;
    for (let c = 0; c < 3; c++) {
      const v = S.tri[3*f+c];
      if (vmap[v] < 0) { vmap[v] = P.length / 3; P.push(S.pos[3*v], S.pos[3*v+1], S.pos[3*v+2]); if (rim.has(v)) rimNew.add(vmap[v]); }
      T.push(vmap[v]);
    }
  });
  const labels = Int32Array.from(keep, (f) => shift[S.labels[f]]);
  const uids = new Set(js.map((j) => S.parts[j].uid).filter(Boolean));
  S.parts = S.parts.filter((_, l) => !gone.has(l));
  for (const p of S.parts) { // seeds are face indexes; links to a deleted part go
    p.seeds = p.seeds.map((f) => newF[f]).filter((f) => f >= 0);
    if (p.follow && uids.has(p.follow.to)) delete p.follow;
    if (p.reach && uids.has(p.reach.to)) { delete p.reach; if (p.xf) { delete p.xf.m; delete p.xf.rig; } }
    if (p.hold && (uids.has(p.hold.a) || uids.has(p.hold.b))) { delete p.hold; if (p.xf) { delete p.xf.m; delete p.xf.rig; } }
  }
  mergeSel.clear(); S.active = 0;
  setMesh(Float32Array.from(P), Uint32Array.from(T)); S.labels = labels; clearMeshCaches();
  const n = close ? closeHoleFaces((h) => h.lp.some(([a]) => rimNew.has(a))) : 0;
  pushUndo(before);
  const what = names.length > 1 ? `${names.length} parts` : names[0];
  afterEdit(close ? `Deleted ${what} from the model${n ? `; closed ${n} hole${n > 1 ? "s" : ""} it left` : ""}` : `Deleted ${what} from the model; holes left open (right-click > Close holes)`);
}
// Crease snapping and boundary anti-aliasing: see core.js.
const snapCreases = (mask = null) => core.snapCreases(S, mask, smoothIters());
function smoothCut(mask = null) { const tri0 = S.tri, n = core.smoothCut(S, mask); meshChanged(tri0); return n; }
function setMesh(pos, tri, G = null) { core.setMesh(S, pos, tri, G); buildMesh(); }
function smoothBoundaries() {
  const before = snapshot(), n = snapCreases() + smoothCut();
  if (!n) { status("No boundaries to smooth"); return; }
  pushUndo(before);
  afterEdit(`Smoothed boundaries: split ${n.toLocaleString()} faces`);
}

// ---------------------------------------------------------------- mesh display
// Shading: a vertex's normal is averaged over its faces, except where that average is more than ~37° off the face's own
// normal (a box edge): there the face's normal is used, so flat faces next to sharp edges stay flat.
const SMOOTH_COS = 0.8;
function buildMesh() {
  if (mesh) { scene.remove(mesh); mesh.geometry.disposeBoundsTree?.(); mesh.geometry.dispose(); }
  if (fillMesh) { scene.remove(fillMesh); fillMesh.geometry.dispose(); fillMesh = null; } // its parts may be gone (another model)
  const { pos, tri, nF, G } = S;
  // smooth vertex normals for shading
  const vn = new Float32Array(pos.length);
  for (let f = 0; f < nF; f++) for (let c = 0; c < 3; c++) { const v = tri[3*f+c]; for (let k = 0; k < 3; k++) vn[3*v+k] += G.nrm[3*f+k] * G.area[f]; }
  const P = new Float32Array(nF * 9), N = new Float32Array(nF * 9);
  for (let f = 0; f < nF; f++) for (let c = 0; c < 3; c++) {
    const v = tri[3*f+c];
    let nx = vn[3*v], ny = vn[3*v+1], nz = vn[3*v+2];
    // fall back to the face normal across sharp edges
    if (nx*G.nrm[3*f] + ny*G.nrm[3*f+1] + nz*G.nrm[3*f+2] < SMOOTH_COS * Math.hypot(nx, ny, nz)) { nx = G.nrm[3*f]; ny = G.nrm[3*f+1]; nz = G.nrm[3*f+2]; }
    const l = Math.hypot(nx, ny, nz) || 1;
    for (let k = 0; k < 3; k++) P[9*f+3*c+k] = pos[3*v+k];
    N[9*f+3*c] = nx/l; N[9*f+3*c+1] = ny/l; N[9*f+3*c+2] = nz/l;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(N, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(nF * 9), 3));
  mesh = new THREE.Mesh(geo, material);
  mesh.userData.P0 = P.slice(); mesh.userData.N0 = N.slice();
  scene.add(mesh);
  xfKey = "";
  updateColors(); applyXf(); updateVisibility();
}

// ---------------------------------------------------------------- per-part transforms
// part.xf = { s:[sx,sy,sz], r:[rx,ry,rz] deg (XYZ euler), t:[tx,ty,tz] mm, c:[pivot] }. Display and Part STLs only:
// the painted 3MF is one mesh, so it keeps the original geometry.
// x.st = { k: factor, p: pivot, a: unit axis (original coords) } stretches the part along its length from its joint
// before the rest of the transform (see Stretch below).
const isIdXf = (x) => !x || (!x.m && !(x.st && x.st.k !== 1) && x.s.every((v) => v === 1) && x.r.every((v) => v === 0) && x.t.every((v) => v === 0));
function xfMatrix(p) {
  const x = p?.xf; if (isIdXf(x)) return null;
  const B = baseMatrix(x);
  return x.st && x.st.k !== 1 ? B.multiply(stretchMatrix(x.st)) : B;
}
function baseMatrix(x) { // the transform without the stretch: Reach's matrix, or scale/rotate/move about the pivot
  if (x.m) return new THREE.Matrix4().fromArray(x.m); // set by Reach (rotation + stretch along the arm)
  const c = new THREE.Vector3(...x.c);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...x.r.map((d) => d * Math.PI / 180), "XYZ"));
  return new THREE.Matrix4().compose(c.clone().add(new THREE.Vector3(...x.t)), q, new THREE.Vector3(...x.s))
    .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
}
function partBox(i) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let f = 0; f < S.nF; f++) if (S.labels[f] === i) for (let c = 0; c < 3; c++) {
    const v = S.tri[3*f+c]; for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], S.pos[3*v+k]); b[k+3] = Math.max(b[k+3], S.pos[3*v+k]); }
  }
  return b;
}
function ensureXf(i) {
  const p = S.parts[i];
  if (!p.xf) { const b = partBox(i); p.xf = { s: [1, 1, 1], r: [0, 0, 0], t: [0, 0, 0], c: [0, 1, 2].map((k) => isFinite(b[k]) ? (b[k] + b[k+3]) / 2 : 0) }; }
  return p.xf;
}
let xfKey = "";
function applyXf() {
  if (!mesh) return;
  const Ms = S.parts.map(xfMatrix), any = Ms.some(Boolean);
  const key = any ? JSON.stringify(S.parts.map((p) => [p.xf || 0, p.heal || 0, p.anchor || 0, p.fill || 0, p.trim || 0, p.visible !== false])) + "|" + fullHash() : "";
  if (key === xfKey) return;
  xfKey = key;
  const geo = mesh.geometry, P = geo.getAttribute("position").array, N = geo.getAttribute("normal").array, { P0, N0 } = mesh.userData;
  const Ns = Ms.map((m) => m && new THREE.Matrix3().getNormalMatrix(m));
  const v = new THREE.Vector3(), Hs = S.parts.map((_, i) => (Ms[i] ? healField(i) : null));
  for (let f = 0; f < S.nF; f++) {
    const m = Ms[S.labels[f]], nm = Ns[S.labels[f]], h = Hs[S.labels[f]], o = 9 * f;
    for (let k = 0; k < 9; k += 3) {
      if (!m) { for (let j = 0; j < 3; j++) { P[o+k+j] = P0[o+k+j]; N[o+k+j] = N0[o+k+j]; } continue; }
      v.set(P0[o+k], P0[o+k+1], P0[o+k+2]).applyMatrix4(m);
      if (h) { const vi = S.tri[3*f + k/3], w = h.w[vi]; if (w > 0) v.addScaledVector(h.d[h.near[vi]], w); }
      P[o+k] = v.x; P[o+k+1] = v.y; P[o+k+2] = v.z;
      v.set(N0[o+k], N0[o+k+1], N0[o+k+2]).applyMatrix3(nm).normalize(); N[o+k] = v.x; N[o+k+1] = v.y; N[o+k+2] = v.z;
    }
  }
  geo.getAttribute("position").needsUpdate = true; geo.getAttribute("normal").needsUpdate = true;
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  geo.disposeBoundsTree?.(); geo.computeBoundsTree();
  clearTrimMeshes(); // stale until the trim is redone; the part shows untrimmed meanwhile
  updateFillMesh();
  render();
  scheduleHits();
  scheduleTrim();
}

// ---------------------------------------------------------------- collisions
// After a transform, parts that weren't touching in the original model but now pass through each other (a broom
// stick through the stone's handle) are listed on the part card, in the status bar and in Check. Parts that share a
// cut are skipped: they always touch at the cut (heal joint handles those).
let hits = [], hitTimer = 0, nbCache = { key: null, set: null };
function neighborPairs() {
  const key = `${S.nF}|${fullHash()}`;
  if (nbCache.key === key) return nbCache.set;
  const first = new Int32Array(S.nV).fill(-1), set = new Set();
  for (let f = 0; f < S.nF; f++) for (let c = 0; c < 3; c++) {
    const v = S.tri[3*f+c], l = S.labels[f];
    if (first[v] < 0) first[v] = l; else if (first[v] !== l) set.add(Math.min(l, first[v]) + "|" + Math.max(l, first[v]));
  }
  nbCache = { key, set }; return set;
}
// opts.only: check only pairs with a part in this set; opts.gap: also count parts closer than gap mm;
// opts.cache: geometries of parts not in opts.live (or only), which don't change between calls (kept, not disposed).
function findHits(opts = {}) {
  if (!S.G) return [];
  const ch = changedParts(); if (!ch.size) return [];
  const nb = neighborPairs(), G = new Map(), cnt = partCounts(), gap = opts.gap || 0, only = opts.only;
  const geoOf = (i) => {
    if (opts.cache?.has(i) && !(opts.live || only)?.has(i)) return opts.cache.get(i);
    if (!G.has(i)) {
      const v = partSoup(i); let g = null;
      if (v?.length) { g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(v, 3)); g.computeBoundingBox(); g.computeBoundsTree(); }
      if (opts.cache && !(opts.live || only)?.has(i)) { opts.cache.set(i, g); return g; }
      G.set(i, g);
    }
    return G.get(i);
  };
  const ids = S.parts.map((p, i) => i).filter((i) => i > 0 && S.parts[i].visible !== false && (cnt[i] > 0 || hasRep(S.parts[i])));
  const out = [], I = new THREE.Matrix4();
  for (const a of ids) for (const b of ids) {
    if (b <= a || (!ch.has(a) && !ch.has(b)) || nb.has(a + "|" + b) || (only && !only.has(a) && !only.has(b))) continue;
    const ga = geoOf(a), gb = geoOf(b);
    if (!ga || !gb || !ga.boundingBox.clone().expandByScalar(gap).intersectsBox(gb.boundingBox)) continue;
    if (ga.boundsTree.intersectsGeometry(gb, I) || (gap > 0 && ga.boundsTree.closestPointToGeometry(gb, I, {}, {}, 0, gap))) out.push([a, b]);
  }
  for (const g of G.values()) g?.disposeBoundsTree();
  return out;
}
const hitText = (h) => `${S.parts[h[0]].name} goes through ${S.parts[h[1]].name}`;
function scheduleHits() {
  clearTimeout(hitTimer);
  hitTimer = setTimeout(() => {
    try { const k = autoKey(); if (k && k !== lastAutoKey) { solveAutoStretch(); lastAutoKey = autoKey(); applyXf(); syncReps(); drawSeeds(); refreshUI(); autosave(); return; } } catch (e) { console.warn("auto stretch failed", e); }
    try { hits = findHits(); } catch (e) { console.warn("collision check failed", e); hits = []; }
    renderHitRow(S.active);
    if (hits.length) status(`${$("status").textContent.replace(/ · ⚠.*$/, "")} · ⚠ ${hits.map(hitText).join("; ")}`);
  }, 250);
}
function renderHitRow(i) {
  const row = $("hitRow"), mine = hits.filter((h) => h.includes(i));
  row.textContent = mine.length ? `⚠ Goes through ${mine.map((h) => S.parts[h[0] === i ? h[1] : h[0]].name).join(", ")}` : "";
}

// ---------------------------------------------------------------- heal joint
// part.heal = { r: blend mm }. After the part is moved/rotated, each vertex of its joint loop (longest cut) is pulled
// to the neighbor's rim (the same loop at its original place) at the same angle about the joint axis; the pull fades
// to zero over r mm from the cut (cosine falloff), so the part stretches or squeezes to stay flush.
const healCache = new Map();
function healBase(i) { // geometry-only part: loop, rim angles, nearest loop vertex + distance for each part vertex
  const key = `${i}|${S.nF}|${fullHash()}`;
  if (healCache.has(key)) return healCache.get(key);
  if (healCache.size > 8) healCache.clear();
  const pm = meshOf((l) => l === i); let best = null, bl = -1;
  const P = (v) => new THREE.Vector3(S.pos[3*v], S.pos[3*v+1], S.pos[3*v+2]);
  for (const lp of pm?.loopList || []) { let len = 0; for (const [a, b] of lp) len += P(a).distanceTo(P(b)); if (len > bl) { bl = len; best = lp; } }
  if (!best) { healCache.set(key, null); return null; }
  const L = best.map(([a]) => a), pts = L.map(P), J = new THREE.Vector3();
  pts.forEach((p) => J.add(p)); J.divideScalar(pts.length);
  const n = new THREE.Vector3();
  for (let k = 0; k < pts.length; k++) { const a = pts[k], b = pts[(k+1) % pts.length]; n.add(new THREE.Vector3().subVectors(a, b).cross(new THREE.Vector3().subVectors(J, b))); }
  n.normalize();
  const u = new THREE.Vector3(1, 0, 0); if (Math.abs(u.dot(n)) > 0.9) u.set(0, 1, 0);
  u.addScaledVector(n, -u.dot(n)).normalize(); const v = new THREE.Vector3().crossVectors(n, u);
  const ang = (p) => { const d = p.clone().sub(J); return Math.atan2(d.dot(v), d.dot(u)); };
  const rim = pts.map((p) => ({ a: ang(p), p })).sort((x, y) => x.a - y.a);
  const p2 = pts.map((p) => { const d = p.clone().sub(J); return [d.dot(u), d.dot(v)]; }); // loop in the joint plane
  // nearest loop vertex for every vertex of the part (brute force over a subsampled loop, then refined)
  const verts = new Set(); for (let f = 0; f < S.nF; f++) if (S.labels[f] === i) for (let c = 0; c < 3; c++) verts.add(S.tri[3*f+c]);
  const near = new Int32Array(S.nV), dist = new Float32Array(S.nV).fill(Infinity);
  const step = Math.max(1, Math.floor(L.length / 200));
  for (const vi of verts) {
    const x = S.pos[3*vi], y = S.pos[3*vi+1], z = S.pos[3*vi+2], d2 = (k) => (x-pts[k].x)**2 + (y-pts[k].y)**2 + (z-pts[k].z)**2;
    let bk = 0, bd = Infinity;
    for (let k = 0; k < pts.length; k += step) { const d = d2(k); if (d < bd) { bd = d; bk = k; } }
    for (let j = -step; j <= step; j++) { const k = (bk + j + pts.length) % pts.length, d = d2(k); if (d < bd) { bd = d; bk = k; } }
    near[vi] = bk; dist[vi] = Math.sqrt(bd);
  }
  const out = { L, pts, p2, J, n, u, v, rim, near, dist, verts, len: bl };
  healCache.set(key, out); return out;
}
// Point on the fixed rim where the ray from the joint center at angle a crosses it (the crossing nearest `m` when the
// loop is not star-shaped). Falls back to angle-sorted interpolation if no segment is hit.
function rimHit(B, a, m) {
  const cx = Math.cos(a), cy = Math.sin(a), P = B.p2, n = P.length;
  let best = null, bd = Infinity;
  for (let k = 0; k < n; k++) {
    const [x0, y0] = P[k], [x1, y1] = P[(k+1) % n], ex = x1 - x0, ey = y1 - y0;
    const den = cx * ey - cy * ex; if (Math.abs(den) < 1e-12) continue;
    const t = (x0 * ey - y0 * ex) / den, s = (x0 * cy - y0 * cx) / den; // ray param t, segment param s
    if (t <= 0 || s < 0 || s > 1) continue;
    const q = B.pts[k].clone().lerp(B.pts[(k+1) % n], s), d = q.distanceToSquared(m);
    if (d < bd) { bd = d; best = q; }
  }
  return best || rimAt(B, a);
}
function rimAt(B, a) { // point on the fixed rim at angle a (linear between the two rim vertices around it)
  const R = B.rim, m = R.length; let lo = 0, hi = m;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (R[mid].a < a) lo = mid + 1; else hi = mid; }
  const r1 = R[lo % m], r0 = R[(lo - 1 + m) % m];
  let a0 = r0.a, a1 = r1.a; if (lo === 0) a0 -= 2 * Math.PI; if (lo === m) a1 += 2 * Math.PI;
  const t = a1 - a0 > 1e-9 ? (a - a0) / (a1 - a0) : 0;
  return r0.p.clone().lerp(r1.p, Math.min(1, Math.max(0, t)));
}
const healDefault = (i) => { const B = healBase(i); return B ? +Math.max(1, Math.min(15, B.len / (2 * Math.PI) * 0.2)).toFixed(1) : 5; };
// Per-vertex pull for part i under its current transform: { near, w (weight per vertex), d (pull per loop vertex) }.
function healField(i) {
  const p = S.parts[i]; if (!p?.heal || hasRep(p)) return null;
  const M = xfMatrix(p); if (!M) return null;
  const B = healBase(i); if (!B) return null;
  const r = Math.max(0.1, +p.heal.r || healDefault(i));
  const d = B.pts.map((q) => {
    const m = q.clone().applyMatrix4(M), e = m.clone().sub(B.J);
    return rimHit(B, Math.atan2(e.dot(B.v), e.dot(B.u)), m).sub(m);
  });
  const w = new Float32Array(S.nV);
  for (const vi of B.verts) { const s = B.dist[vi]; if (s < r) w[vi] = 0.5 * (1 + Math.cos(Math.PI * s / r)); }
  return { near: B.near, w, d };
}

// ---------------------------------------------------------------- move with
// part.follow = { to: leader uid, rel: Matrix4 array } keeps a part rigidly attached to another part: its matrix is
// leader matrix x rel. Moving/rotating the leader carries its followers (and theirs); moving a follower itself
// updates rel. Part uids are lazy and survive part deletes/merges that shift indices.
let uidSeq = 1;
const uidOf = (i) => (S.parts[i].uid ||= `u${Date.now().toString(36)}${uidSeq++}`);
const partMat = (i) => xfMatrix(S.parts[i]) || new THREE.Matrix4();
const baseMat = (i) => (isIdXf(S.parts[i].xf) ? new THREE.Matrix4() : baseMatrix(S.parts[i].xf));
// What part j rides on when it moves with / is carried by part l: l's transform without its stretch, shifted by how
// far the stretch moves j's center (a hand carried by a stretched arm moves out with the arm's end, unstretched).
function carryMat(l, j) {
  const x = S.parts[l]?.xf, st = x?.st, M = x?.rig ? new THREE.Matrix4().fromArray(x.rig) : baseMat(l); // rig: Reach/Hold matrix without its own stretch
  if (!st || st.k === 1) return M;
  const c = new THREE.Vector3(...ensureXf(j).c), d = c.clone().applyMatrix4(stretchMatrix(st)).sub(c);
  return M.multiply(new THREE.Matrix4().makeTranslation(d.x, d.y, d.z));
}
function leaderOf(i) { const f = S.parts[i]?.follow; return f ? S.parts.findIndex((q, j) => j > 0 && q.uid === f.to) : -1; }
function followersOf(i) { const u = S.parts[i]?.uid; return u ? S.parts.map((q, j) => (j > 0 && q.follow?.to === u ? j : -1)).filter((j) => j > 0) : []; }
function setXfMatrix(j, M) {
  const x = ensureXf(j), pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  delete x.m; delete x.rig;
  M.decompose(pos, q, sc);
  const e = new THREE.Euler().setFromQuaternion(q, "XYZ"), c = new THREE.Vector3(...x.c), w = c.clone().applyMatrix4(M);
  x.s = sc.toArray().map((v) => +v.toFixed(5)); x.r = [e.x, e.y, e.z].map((v) => +(v * 180 / Math.PI).toFixed(3));
  x.t = [0, 1, 2].map((k) => +(w.getComponent(k) - c.getComponent(k)).toFixed(4));
}
// Call after part i's own transform changed: refresh its offset to its leader, then carry its followers.
function xfEdited(i) {
  if (S.parts[i].xf?.m) { delete S.parts[i].xf.m; delete S.parts[i].xf.rig; }
  const l = leaderOf(i);
  if (l > 0) S.parts[i].follow.rel = carryMat(l, i).invert().multiply(baseMat(i)).toArray();
  carry(i, new Set([i]));
  updateReach();
}
function carry(i, seen) {
  for (const j of followersOf(i)) {
    if (seen.has(j)) continue; seen.add(j);
    setXfMatrix(j, carryMat(i, j).multiply(new THREE.Matrix4().fromArray(S.parts[j].follow.rel)));
    carry(j, seen);
  }
}
function setFollow(js, l) { // js follow part l (null: stop following)
  js = js.filter((j) => j > 0 && j !== l);
  if (l > 0) { // no loops: l must not (indirectly) follow any of js
    for (let k = l, n = 0; k > 0 && n < 100; k = leaderOf(k), n++) if (js.includes(k)) { status(`${S.parts[k].name} already carries ${S.parts[l].name}`); return; }
  }
  if (!js.length) return;
  pushUndo();
  for (const j of js) {
    if (l > 0) S.parts[j].follow = { to: uidOf(l), rel: carryMat(l, j).invert().multiply(baseMat(j)).toArray() };
    else delete S.parts[j].follow;
  }
  const names = js.map((j) => S.parts[j].name).join(", ");
  afterEdit(l > 0 ? `${names} now move${js.length > 1 ? "" : "s"} with ${S.parts[l].name}` : `${names} move${js.length > 1 ? "" : "s"} on ${js.length > 1 ? "their" : "its"} own again`);
}
// part.reach = { to: target uid, p: pivot, e: end (original coords) }: the part turns about its pivot (its joint with
// the rest, e.g. a shoulder) and stretches so its end (where it touches the target, e.g. the hand on the broom) stays
// on the target wherever the target moved. Stored as a full matrix in xf.m.
function reachPoints(j, k) {
  const vs = (i) => { const s = new Set(); for (let f = 0; f < S.nF; f++) if (S.labels[f] === i) for (let c = 0; c < 3; c++) s.add(S.tri[3*f+c]); return s; };
  const A = vs(j), T = vs(k), cen = (arr) => { const c = new THREE.Vector3(); for (const v of arr) c.add(new THREE.Vector3(S.pos[3*v], S.pos[3*v+1], S.pos[3*v+2])); return c.divideScalar(arr.length || 1); };
  let shared = [...A].filter((v) => T.has(v));
  if (!shared.length) { // not touching: the band of j closest to k
    const tv = [...T], d = new Map(); let mn = Infinity;
    for (const v of A) { let b = Infinity; for (const u of tv) b = Math.min(b, (S.pos[3*v]-S.pos[3*u])**2 + (S.pos[3*v+1]-S.pos[3*u+1])**2 + (S.pos[3*v+2]-S.pos[3*u+2])**2); d.set(v, Math.sqrt(b)); mn = Math.min(mn, Math.sqrt(b)); }
    shared = [...A].filter((v) => d.get(v) <= mn + 2);
  }
  const e = cen(shared);
  // pivot: the boundary with the neighbor (other than k and parts moving with k) that shares the most vertices
  const skip = new Set([k, j, 0]); for (let l = leaderOf(k), n = 0; l > 0 && n < 100; l = leaderOf(l), n++) skip.add(l);
  const cnt = new Map();
  for (let f = 0; f < S.nF; f++) { const l = S.labels[f]; if (skip.has(l)) continue; for (let c = 0; c < 3; c++) { const v = S.tri[3*f+c]; if (A.has(v)) { if (!cnt.has(l)) cnt.set(l, new Set()); cnt.get(l).add(v); } } }
  const best = [...cnt].sort((a, b) => b[1].size - a[1].size)[0];
  let p;
  if (best) p = cen([...best[1]]);
  else { let far = null, fd = -1; for (const v of A) { const q = new THREE.Vector3(S.pos[3*v], S.pos[3*v+1], S.pos[3*v+2]), dd = q.distanceTo(e); if (dd > fd) { fd = dd; far = q; } } p = far; }
  return { p: p.toArray(), e: e.toArray() };
}
function reachOf(i) { const r = S.parts[i]?.reach; return r ? S.parts.findIndex((q, j) => j > 0 && q.uid === r.to) : -1; }
// part.hold = { a, b: holder uids, ga, gb: grip points (original coords) }: the part (a broom stick) is placed so its
// two grips sit on the two holders (hands) wherever they moved: the grip-to-grip line is turned onto the new one
// (shortest turn), stretched along it to the new grip distance and centered between the new grips. Parts that move
// with it are carried rigidly (without the stretch).
function holdersOf(j) { const h = S.parts[j]?.hold; if (!h) return null; const f = (u) => S.parts.findIndex((q, k) => k > 0 && q.uid === u); const a = f(h.a), b = f(h.b); return a > 0 && b > 0 ? [a, b] : null; }
function updateHolds() {
  S.parts.forEach((q, j) => {
    const hb = holdersOf(j); if (!hb) return;
    const A0 = new THREE.Vector3(...q.hold.ga), B0 = new THREE.Vector3(...q.hold.gb);
    const A1 = A0.clone().applyMatrix4(partMat(hb[0])), B1 = B0.clone().applyMatrix4(partMat(hb[1]));
    const d0 = B0.clone().sub(A0), d1 = B1.clone().sub(A1); if (d0.lengthSq() < 1e-9 || d1.lengthSq() < 1e-9) return;
    const kS = q.hold.stretch === false ? 1 : d1.length() / d0.length(); // stretch so both grips land on the hands
    const R = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(d0.normalize(), d1.normalize()));
    const m0 = A0.clone().add(B0).multiplyScalar(0.5), m1 = A1.clone().add(B1).multiplyScalar(0.5), a = d0;
    const S3 = new THREE.Matrix4().set(
      1 + (kS-1)*a.x*a.x, (kS-1)*a.x*a.y, (kS-1)*a.x*a.z, 0,
      (kS-1)*a.y*a.x, 1 + (kS-1)*a.y*a.y, (kS-1)*a.y*a.z, 0,
      (kS-1)*a.z*a.x, (kS-1)*a.z*a.y, 1 + (kS-1)*a.z*a.z, 0, 0, 0, 0, 1);
    const M = new THREE.Matrix4().makeTranslation(m1.x, m1.y, m1.z).multiply(R).multiply(S3).multiply(new THREE.Matrix4().makeTranslation(-m0.x, -m0.y, -m0.z));
    setXfMatrix(j, M); const xh = ensureXf(j); xh.m = M.toArray();
    xh.rig = new THREE.Matrix4().makeTranslation(m1.x, m1.y, m1.z).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-m0.x, -m0.y, -m0.z)).toArray();
    carry(j, new Set([j]));
  });
}
function setHold(j, a, b) { // part j held by parts a and b (a <= 0: release)
  if (j <= 0) return;
  pushUndo();
  const q = S.parts[j];
  if (a > 0) { q.hold = { a: uidOf(a), b: uidOf(b), ga: reachPoints(a, j).e, gb: reachPoints(b, j).e }; delete q.follow; delete q.reach; updateReach(); }
  else { delete q.hold; if (q.xf) { delete q.xf.m; delete q.xf.rig; } }
  afterEdit(a > 0 ? `${q.name} is held by ${S.parts[a].name} and ${S.parts[b].name}` : `${q.name} is no longer held`);
}
function updateReach() {
  updateHolds();
  S.parts.forEach((q, j) => {
    const k = reachOf(j); if (k <= 0) return;
    const P = new THREE.Vector3(...q.reach.p), E0 = new THREE.Vector3(...q.reach.e), E1 = E0.clone().applyMatrix4(partMat(k));
    const d0 = E0.clone().sub(P), d1 = E1.clone().sub(P), L0 = d0.length(), L1 = d1.length();
    if (L0 < 1e-6 || L1 < 1e-6) return;
    const a = d0.clone().divideScalar(L0), kS = q.reach.stretch === false ? 1 : L1 / L0;
    const S3 = new THREE.Matrix4().set( // stretch by kS along a
      1 + (kS-1)*a.x*a.x, (kS-1)*a.x*a.y, (kS-1)*a.x*a.z, 0,
      (kS-1)*a.y*a.x, 1 + (kS-1)*a.y*a.y, (kS-1)*a.y*a.z, 0,
      (kS-1)*a.z*a.x, (kS-1)*a.z*a.y, 1 + (kS-1)*a.z*a.z, 0, 0, 0, 0, 1);
    const R = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(a, d1.clone().divideScalar(L1)));
    const M = new THREE.Matrix4().makeTranslation(P.x, P.y, P.z).multiply(R).multiply(S3).multiply(new THREE.Matrix4().makeTranslation(-P.x, -P.y, -P.z));
    setXfMatrix(j, M); const xr = ensureXf(j); xr.m = M.toArray();
    xr.rig = new THREE.Matrix4().makeTranslation(P.x, P.y, P.z).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-P.x, -P.y, -P.z)).toArray();
  });
}
function setReach(j, k) { // part j reaches for part k (k <= 0: stop)
  if (j <= 0 || j === k) return;
  pushUndo();
  const q = S.parts[j];
  if (k > 0) { q.reach = { to: uidOf(k), ...reachPoints(j, k) }; delete q.follow; updateReach(); }
  else { delete q.reach; if (q.xf) { delete q.xf.m; delete q.xf.rig; } }
  afterEdit(k > 0 ? `${q.name} now reaches for ${S.parts[k].name}: it turns at its joint and stretches to stay on it` : `${q.name} stopped reaching`);
}
// ---------------------------------------------------------------- stretch
// part.xf.st = { k, p, a }: the part is lengthened (k > 1) or shortened along its own length, from its joint with the
// rest (e.g. an arm from the shoulder), before its other transform. The joint stays put, so heal keeps it seated;
// what it holds, or carries, moves out with its end, and Hold / Reach re-solve on the new grip points.
function stretchMatrix(st) {
  const k = st.k, a = new THREE.Vector3(...st.a), P = new THREE.Vector3(...st.p);
  return new THREE.Matrix4().makeTranslation(P.x, P.y, P.z).multiply(new THREE.Matrix4().set(
    1 + (k-1)*a.x*a.x, (k-1)*a.x*a.y, (k-1)*a.x*a.z, 0,
    (k-1)*a.y*a.x, 1 + (k-1)*a.y*a.y, (k-1)*a.y*a.z, 0,
    (k-1)*a.z*a.x, (k-1)*a.z*a.y, 1 + (k-1)*a.z*a.z, 0, 0, 0, 0, 1)).multiply(new THREE.Matrix4().makeTranslation(-P.x, -P.y, -P.z));
}
// Pivot: the boundary shared with the neighbor it is attached to (the most shared vertices), skipping parts that
// hang off it (what it carries, holds or reaches for). Axis: from the pivot to its far end (the farthest 10%).
function stretchFrame(i) {
  const u = S.parts[i].uid, skip = new Set([0, i, ...followersOf(i)]);
  if (u) S.parts.forEach((q, j) => { if (j > 0 && (q.hold?.a === u || q.hold?.b === u)) skip.add(j); });
  if (reachOf(i) > 0) skip.add(reachOf(i));
  const A = new Set(); for (let f = 0; f < S.nF; f++) if (S.labels[f] === i) for (let c = 0; c < 3; c++) A.add(S.tri[3*f+c]);
  if (!A.size) return null;
  const V = (v) => new THREE.Vector3(S.pos[3*v], S.pos[3*v+1], S.pos[3*v+2]);
  const cnt = new Map();
  for (let f = 0; f < S.nF; f++) { const l = S.labels[f]; if (skip.has(l)) continue; for (let c = 0; c < 3; c++) { const v = S.tri[3*f+c]; if (A.has(v)) { if (!cnt.has(l)) cnt.set(l, new Set()); cnt.get(l).add(v); } } }
  const best = [...cnt].sort((x, y) => y[1].size - x[1].size)[0];
  const P = new THREE.Vector3();
  if (best) { for (const v of best[1]) P.add(V(v)); P.divideScalar(best[1].size); }
  else { const b = partBox(i); P.set((b[0]+b[3])/2, (b[1]+b[4])/2, b[2]); } // separate shell: from its bottom
  const ds = [...A].map((v) => [P.distanceTo(V(v)), v]).sort((x, y) => y[0] - x[0]);
  const far = new THREE.Vector3(), nFar = Math.max(1, Math.ceil(ds.length * 0.1));
  for (let k = 0; k < nFar; k++) far.add(V(ds[k][1]));
  const a = far.divideScalar(nFar).sub(P); if (a.lengthSq() < 1e-9) return null;
  return { p: P.toArray().map((v) => +v.toFixed(4)), a: a.normalize().toArray().map((v) => +v.toFixed(6)) };
}
// Stretch parts js to pct % of their length (100 = off). One undo step.
function setStretch(js, pct) {
  js = js.filter((j) => j > 0 && S.parts[j] && !hasRep(S.parts[j]));
  const k = Math.max(0.2, Math.min(5, (+pct || 100) / 100));
  if (!js.length) return;
  pushUndo();
  const done = [];
  for (const j of js) {
    const x = ensureXf(j);
    if (k === 1) { delete x.st; done.push(j); continue; }
    const fr = x.st ? { p: x.st.p, a: x.st.a } : stretchFrame(j);
    if (!fr) continue;
    x.st = { k: +k.toFixed(4), ...fr }; done.push(j);
  }
  for (const j of done) xfEdited(j);
  const names = done.map((j) => S.parts[j].name).join(", ");
  afterEdit(done.length ? (k === 1 ? `Stretch off on ${names}` : `${names} stretched to ${Math.round(k * 1000) / 10}% from ${done.length > 1 ? "their joints" : "its joint"}`) : "Nothing to stretch");
}
// Auto stretch: st.auto parts get the smallest stretch (same for all of them, e.g. both arms) that keeps every part
// they move (what they hold or carry) at least st.gap mm from parts it didn't touch before. Re-solved whenever
// another transform, link or the model changes.
const autoParts = () => S.parts.map((q, i) => (i > 0 && q.xf?.st?.auto ? i : -1)).filter((i) => i > 0);
let lastAutoKey = null;
function autoKey() { // everything the solve depends on, minus what it sets
  const A = autoParts(); if (!A.length || !S.G) return "";
  const D = autoMoved(A);
  return JSON.stringify(S.parts.map((q, i) => {
    if (A.includes(i)) { const { k, ...st } = q.xf.st; return [{ ...q.xf, m: 0, rig: 0, st }, q.follow, q.hold, q.reach, q.heal]; }
    return [D.has(i) ? 0 : q.xf || 0, q.follow, q.hold, q.reach, q.heal, q.visible];
  })) + "|" + fullHash();
}
function autoMoved(A) { // auto parts plus everything that moves because they do
  const set = new Set(A);
  for (let grow = true, n = 0; grow && n < 50; n++) {
    grow = false;
    S.parts.forEach((q, j) => {
      if (j <= 0 || set.has(j)) return;
      const hb = holdersOf(j), l = leaderOf(j), r = reachOf(j);
      if ((l > 0 && set.has(l)) || (hb && hb.some((h) => set.has(h))) || (r > 0 && set.has(r))) { set.add(j); grow = true; }
    });
  }
  return set;
}
function solveAutoStretch() {
  const A = autoParts(); if (!A.length) return;
  // checked: what the auto parts move (the broom they hold, a hand they carry); the auto parts themselves only if they move nothing
  const moved = autoMoved(A), carried = new Set([...moved].filter((i) => !A.includes(i))), only = carried.size ? carried : moved;
  const gap = Math.max(...A.map((i) => +S.parts[i].xf.st.gap || 0)), cache = new Map();
  const test = (k) => { for (const i of A) { S.parts[i].xf.st.k = k; xfEdited(i); } return findHits({ only, gap, cache, live: moved }).length; };
  let k = 1;
  if (test(1)) {
    let lo = 1, hi = 0;
    for (let t = 1.1; t <= 3.0001; t += 0.1) { if (!test(+t.toFixed(2))) { hi = +t.toFixed(2); break; } lo = +t.toFixed(2); }
    if (hi) { for (let it = 0; it < 6; it++) { const m = (lo + hi) / 2; if (test(m)) lo = m; else hi = m; } k = +hi.toFixed(3); }
    else k = 1; // nothing up to 300% clears it: a stretch that still collides only distorts the part, so stay at 100%
  }
  const left = test(k);
  for (const g of cache.values()) g?.disposeBoundsTree();
  const names = A.map((i) => S.parts[i].name).join(", ");
  status(left ? `Auto stretch: no stretch up to 300% keeps ${names} ${gap} mm clear, so ${A.length > 1 ? "they stay" : "it stays"} at 100%`
    : k === 1 ? `Auto stretch: ${names} ${A.length > 1 ? "need" : "needs"} no stretch (${gap} mm gap)` : `Auto stretch: ${names} at ${+(k * 100).toFixed(1)}% to clear by ${gap} mm`);
}
function setAutoStretch(js, on, gap) {
  js = js.filter((j) => j > 0 && S.parts[j] && !hasRep(S.parts[j]));
  if (!js.length) return;
  pushUndo();
  for (const j of js) {
    const x = ensureXf(j);
    if (on) {
      const fr = x.st ? { p: x.st.p, a: x.st.a } : stretchFrame(j); if (!fr) continue;
      x.st = { k: x.st?.k ?? 1, ...fr, auto: true, gap: gap ?? x.st?.gap ?? 1 };
    } else if (x.st) { delete x.st.auto; delete x.st.gap; if (x.st.k === 1) delete x.st; }
    xfEdited(j);
  }
  lastAutoKey = null;
  afterEdit(on ? "Auto stretch on: finding the smallest stretch that clears…" : "Auto stretch off");
  scheduleHits(); // applyXf skips it when no part has a transform yet, and the solve runs from it
}
function renderFollowRow(i) {
  const row = $("followRow"); row.innerHTML = "";
  if (!S.G || i <= 0 || !S.parts[i]) return;
  const chip = (j, label) => {
    const c = document.createElement("span"); c.className = "chip"; c.innerHTML = `<span class="sw" style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${S.parts[j].color}"></span>${esc(label)}`;
    const x = document.createElement("button"); x.textContent = "×"; x.title = "Stop moving together";
    x.onclick = () => setFollow([j === leaderOf(i) ? i : j], null); c.appendChild(x); return c;
  };
  const l = leaderOf(i), fs = followersOf(i), rk = reachOf(i), hb = holdersOf(i);
  if (hb) { row.append("Held by "); for (const k of hb) { const c = chip(k, S.parts[k].name); c.querySelector("button").onclick = () => setHold(i, 0); row.appendChild(c); } }
  if (rk > 0) { const c = chip(rk, S.parts[rk].name); c.querySelector("button").onclick = () => setReach(i, 0); row.append("Reaches for "); row.appendChild(c); }
  if (l > 0) { row.append("Moves with "); row.appendChild(chip(l, S.parts[l].name)); }
  if (fs.length) { if (l > 0) row.append(" · "); row.append("Carries "); for (const j of fs) row.appendChild(chip(j, S.parts[j].name)); }
}
// Heal a triangle soup given in the part's original coordinates (already transformed into `out`).
function healSoup(i, orig, out) {
  const h = healField(i); if (!h) return out;
  const B = healBase(i), r = Math.max(0.1, +S.parts[i].heal.r || healDefault(i));
  for (let o = 0; o < orig.length; o += 3) {
    const x = orig[o], y = orig[o+1], z = orig[o+2];
    let bk = 0, bd = Infinity; for (let k = 0; k < B.pts.length; k++) { const q = B.pts[k], dd = (x-q.x)**2 + (y-q.y)**2 + (z-q.z)**2; if (dd < bd) { bd = dd; bk = k; } }
    const s = Math.sqrt(bd); if (s >= r) continue;
    const w = 0.5 * (1 + Math.cos(Math.PI * s / r)), dv = h.d[bk];
    out[o] += w * dv.x; out[o+1] += w * dv.y; out[o+2] += w * dv.z;
  }
  return out;
}

// ---------------------------------------------------------------- fill / anchor
// When a part moves away from a neighbor, the cut between them opens and each side shows a hole. Fill (the default)
// closes each side with a patch that follows the surrounding surface, so the body stays smooth where a hand used to
// rest. Anchor (part.anchor) keeps the part joined instead: new material sweeps from the neighbor's rim to the part's
// moved cut, along the same turn, so an arm turned at the shoulder stays attached to the body.
let twinCache = { key: null, map: null }, loopCache = new Map();
function twinLabels(hash) { // directed edge a->b (key a*nV+b) -> label of the face that has it
  const key = `${S.nF}|${hash}`;
  if (twinCache.key === key) return twinCache.map;
  const map = new Map(), nV = S.nV;
  for (let f = 0; f < S.nF; f++) for (let e = 0; e < 3; e++) map.set(S.tri[3*f+e] * nV + S.tri[3*f+(e+1)%3], S.labels[f]);
  twinCache = { key, map }; return map;
}
// One pass of world positions: each part's matrix and heal field, computed once.
function fillCtx() {
  const M = new Map(), H = new Map(), hash = fullHash();
  const mat = (l) => { if (!M.has(l)) M.set(l, l > 0 && S.parts[l] ? xfMatrix(S.parts[l]) : null); return M.get(l); };
  const heal = (l) => { if (!H.has(l)) H.set(l, mat(l) ? healField(l) : null); return H.get(l); };
  const ctx = {};
  const wpos = (l, v, out = new THREE.Vector3()) => {
    if (l === ctx.fixL && ctx.fix.has(v)) { const o = ctx.fix.get(v); return out.set(ctx.fixV[o], ctx.fixV[o+1], ctx.fixV[o+2]); }
    out.set(S.pos[3*v], S.pos[3*v+1], S.pos[3*v+2]); const m = mat(l); if (!m) return out;
    out.applyMatrix4(m); const h = heal(l); if (h && h.w[v] > 0) out.addScaledVector(h.d[h.near[v]], h.w[v]);
    return out;
  };
  return Object.assign(ctx, { mat, heal, wpos, hash, tol: 1e-4 * (S.G?.diag || 100) });
}
const anchored = (l) => l > 0 && !!S.parts[l]?.anchor && !hasRep(S.parts[l]);
// Fill and Anchor act only at a part's joint (the cut it turns about, toward the body). Its other cuts (e.g. a hand's
// grip around a broom) stay Open.
const atJoint = (l, lp) => bodyJoint(l)?.loopKey === core.loopKey(lp);
const anchoredAt = (l, lp) => anchored(l) && atJoint(l, lp), filledAt = (l, lp) => filled(l) && atJoint(l, lp);
const filled = (l) => l > 0 && !!S.parts[l]?.fill && !hasRep(S.parts[l]);
function partLoops(l, ctx) { // boundary loops of part l (geometry only, cached)
  const key = `${l}|${S.nF}|${ctx.hash}`;
  if (!loopCache.has(key)) { if (loopCache.size > 40) loopCache.clear(); loopCache.set(key, partMesh(l)?.loopList || []); }
  return loopCache.get(key);
}
// What closes each boundary loop of a mesh: "fan" (no gap: a flat cap that the neighbor's cap meets), "patch" (Fill),
// "bridge" (this side is anchored), "under" (the neighbor is anchored and bridges over it) or "pocket" (a recess part and
// its neighbor, both in place: the recess skin from core.pocketShell instead of a flat cap).
function loopPlans(loops, ctx) {
  const tw = twinLabels(ctx.hash), nV = S.nV, out = [], a3 = new THREE.Vector3(), b3 = new THREE.Vector3();
  const major = (m) => { let best = -1, bn = 0; for (const [k, n] of m) if (n > bn) { bn = n; best = k; } return best; };
  for (const lp of loops) {
    const oc = new Map(), nc = new Map();
    for (const [a, b] of lp) {
      const o = tw.get(a * nV + b), n = tw.get(b * nV + a);
      oc.set(o, (oc.get(o) || 0) + 1); if (n !== undefined) nc.set(n, (nc.get(n) || 0) + 1);
    }
    const own = major(oc), nb = nc.size ? major(nc) : -1;
    let kind = "fan";
    if (nb >= 0 && S.parts[nb]) {
      let gap = hasRep(S.parts[nb]);
      if (!gap) { let g = 0; for (const [a] of lp) if (ctx.wpos(own, a, a3).distanceTo(ctx.wpos(nb, a, b3)) > ctx.tol) g++; gap = g > lp.length / 2; }
      if (gap) {
        const rep = hasRep(S.parts[nb]);
        const ao = !rep && anchoredAt(own, lp), an = !rep && anchoredAt(nb, lp);
        if (ao && (!an || own < nb)) kind = "bridge";
        else if (an) kind = "under";
        else if (rep || filledAt(own, lp) || filledAt(nb, lp)) kind = "patch"; // a replaced neighbor always gets Fill
        // else Open (the default): each side keeps a flat cap and the gap stays visible
      }
    }
    if (kind === "fan" && !ctx.mat(own) && !(nb > 0 && ctx.mat(nb))) { // a recess and its neighbor, both in place: the skin
      const key = core.loopKey(lp), po = pocketOf(own, ctx.hash), pn = nb > 0 ? pocketOf(nb, ctx.hash) : null;
      if (po?.key === key) { out.push({ lp, own, nb, kind: "pocket", tris: po.tris }); continue; }
      if (pn?.key === key) { out.push({ lp, own, nb, kind: "pocket", tris: core.reverseSoup(pn.tris) }); continue; }
    }
    out.push({ lp, own, nb, kind });
  }
  return out;
}
const pocketCache = new Map();
function pocketOf(l, hash) { // core.pocketShell for part l, cached
  if (!(l > 0) || !S.parts[l]) return null;
  const key = `${l}|${S.nF}|${hash}`;
  if (!pocketCache.has(key)) { if (pocketCache.size > 60) pocketCache.clear(); pocketCache.set(key, core.pocketShell(S, l, partMesh(l))); }
  return pocketCache.get(key);
}
// Smooth patch over a loop, in original coordinates: rings shrinking from the loop to its center, lifted onto a
// quadratic fitted to the surface of part fitL around the hole (the body's curve continues across it). fitL < 0: a
// plane fitted to the loop (the flat cut face of the smaller part).
const patchCache = new Map();
function patchRings(lp, fitL, hash) {
  const key = `${fitL}|${lp[0][0]}|${lp[0][1]}|${lp.length}|${S.nF}|${hash}`;
  if (patchCache.has(key)) return patchCache.get(key);
  if (patchCache.size > 60) patchCache.clear();
  const L = lp.map((e) => e[0]), n = L.length, V = (v) => new THREE.Vector3(S.pos[3*v], S.pos[3*v+1], S.pos[3*v+2]);
  const pts = L.map(V), C = new THREE.Vector3(); pts.forEach((p) => C.add(p)); C.divideScalar(n);
  let rbar = 0, per = 0; for (let k = 0; k < n; k++) { rbar += pts[k].distanceTo(C); per += pts[k].distanceTo(pts[(k+1) % n]); }
  rbar /= n; const edge = per / n, R = 1.8 * rbar + 2 * edge;
  // surface normal around the hole: the fit part's faces at the loop (Newell normal of the loop as a fallback)
  const inLoop = new Set(L), G = S.G, nrm = new THREE.Vector3(), cand = [];
  for (let f = 0; f < S.nF; f++) {
    if (S.labels[f] !== fitL) continue;
    const a = S.tri[3*f], b = S.tri[3*f+1], c = S.tri[3*f+2];
    if (inLoop.has(a) || inLoop.has(b) || inLoop.has(c)) nrm.x += G.nrm[3*f] * G.area[f], nrm.y += G.nrm[3*f+1] * G.area[f], nrm.z += G.nrm[3*f+2] * G.area[f];
    const dx = S.pos[3*a] - C.x, dy = S.pos[3*a+1] - C.y, dz = S.pos[3*a+2] - C.z;
    if (dx*dx + dy*dy + dz*dz < R*R) cand.push(f);
  }
  if (nrm.lengthSq() < 1e-12) for (let k = 0; k < n; k++) { const a = pts[k], b = pts[(k+1) % n]; nrm.add(new THREE.Vector3().subVectors(a, C).cross(new THREE.Vector3().subVectors(b, C))); }
  nrm.normalize(); if (nrm.lengthSq() < 0.5) nrm.set(0, 0, 1);
  const u = new THREE.Vector3(1, 0, 0); if (Math.abs(u.dot(nrm)) > 0.9) u.set(0, 1, 0);
  u.addScaledVector(nrm, -u.dot(nrm)).normalize(); const w = new THREE.Vector3().crossVectors(nrm, u);
  const loc = (p) => { const d = p.clone().sub(C); return [d.dot(u), d.dot(w), d.dot(nrm)]; };
  // least squares h = c0 + c1 x + c2 y (+ c3 x² + c4 xy + c5 y²) over the fit part's vertices facing the same way
  const D = fitL > 0 ? 6 : 3, A = Array.from({ length: D }, () => new Float64Array(D + 1)); let ns = 0, hmin = Infinity, hmax = -Infinity;
  const addPt = (p) => {
    const [x, y, h] = loc(p), r = [1, x, y, x*x, x*y, y*y];
    for (let i = 0; i < D; i++) { for (let j = 0; j < D; j++) A[i][j] += r[i] * r[j]; A[i][D] += r[i] * h; }
    ns++; hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
  };
  if (fitL > 0) {
    const seen = new Set();
    for (const f of cand) {
      if (G.nrm[3*f] * nrm.x + G.nrm[3*f+1] * nrm.y + G.nrm[3*f+2] * nrm.z < 0.2) continue;
      for (let c = 0; c < 3; c++) { const v = S.tri[3*f+c]; if (!seen.has(v)) { seen.add(v); addPt(V(v)); } }
    }
  } else pts.forEach(addPt);
  let co = null;
  if (ns >= 2 * D) { // Gaussian elimination with a little ridge so a flat sample set stays solvable
    for (let i = 0; i < D; i++) A[i][i] += 1e-6 * (A[0][0] || 1) * (i > 2 ? rbar ** 4 : i ? rbar ** 2 : 1);
    try {
      for (let i = 0; i < D; i++) {
        let p = i; for (let r = i + 1; r < D; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
        [A[i], A[p]] = [A[p], A[i]]; if (Math.abs(A[i][i]) < 1e-14) throw 0;
        for (let r = 0; r < D; r++) if (r !== i) { const k = A[r][i] / A[i][i]; for (let c = i; c <= D; c++) A[r][c] -= k * A[i][c]; }
      }
      co = A.map((row, i) => row[D] / row[i]); while (co.length < 6) co.push(0);
    } catch { co = null; }
  }
  const lo = Math.min(hmin, 0) - rbar * 0.5, hi = Math.max(hmax, 0) + rbar * 0.5;
  const fit = (x, y) => co ? Math.max(lo, Math.min(hi, co[0] + co[1]*x + co[2]*y + co[3]*x*x + co[4]*x*y + co[5]*y*y)) : 0;
  const P2 = pts.map(loc), K = Math.max(2, Math.min(6, Math.round(rbar / Math.max(3 * edge, 1e-6))));
  // the loop as (x, y, height off the fit): a cut follows mesh edges, so it zigzags; copied inward unsmoothed, the
  // zigzag shows as fine radial ridges (a "pie"). Each inner ring takes a copy smoothed over more of the loop.
  const L3 = new Float64Array(3 * n); P2.forEach(([x, y, h], k) => { L3[3*k] = x; L3[3*k+1] = y; L3[3*k+2] = h - fit(x, y); });
  const rings = [], s = [], idx = [];
  // a first ring close to the loop keeps the row that takes up the loop's zigzag narrow
  for (const t of [1 - 0.3 / K, ...Array.from({ length: K - 1 }, (_, k) => 1 - (k + 1) / K)]) { // inner rings get fewer points, keeping their edges about as long as the loop's
    const m = Math.max(6, Math.round(n * t)), ring = new Float32Array(3 * m), ix = new Int32Array(m);
    const Ls = loopSmooth(L3, Math.round((1 - t) * rbar / Math.max(edge, 1e-6)));
    for (let j = 0; j < m; j++) {
      const q = ix[j] = Math.round(j * n / m) % n, x = t * Ls[3*q], y = t * Ls[3*q+1], h = fit(x, y) + t * Ls[3*q+2];
      ring[3*j] = C.x + x*u.x + y*w.x + h*nrm.x; ring[3*j+1] = C.y + x*u.y + y*w.y + h*nrm.y; ring[3*j+2] = C.z + x*u.z + y*w.z + h*nrm.z;
    }
    rings.push(ring); s.push(t); idx.push(ix);
  }
  const hc = fit(0, 0), c = [C.x + hc*nrm.x, C.y + hc*nrm.y, C.z + hc*nrm.z];
  const out = { rings, t: s, idx, c }; patchCache.set(key, out); return out;
}
// Moving average around a closed loop (flat xyz array): a box of half-width h, twice. h < 1: a copy.
function loopSmooth(P, h) {
  const n = P.length / 3; let A = Float64Array.from(P);
  h = Math.min(h, Math.floor((n - 1) / 2)); if (!(h >= 1)) return A;
  for (let pass = 0; pass < 2; pass++) {
    const B = new Float64Array(A.length), w = 2 * h + 1;
    for (let c = 0; c < 3; c++) {
      let sum = 0; for (let k = -h; k <= h; k++) sum += A[3 * ((k + n) % n) + c];
      for (let j = 0; j < n; j++) { B[3*j+c] = sum / w; sum += A[3 * ((j + h + 1) % n) + c] - A[3 * ((j - h + n) % n) + c]; }
    }
    A = B;
  }
  return A;
}
// Triangles between rings (ring 0 = the loop as the part sees it, a->b along its boundary; each inner ring starts at
// the same place and may have fewer points) and a center point, wound so they close the part's boundary.
// flip: the part is mirrored.
function ringTris(rings, c, flip, out) {
  const tri = (A, i, B, j, Cc, k) => {
    const p = [A, i, B, j, Cc, k];
    if (flip) { [p[2], p[3], p[4], p[5]] = [p[4], p[5], p[2], p[3]]; }
    for (let q = 0; q < 6; q += 2) { const R = p[q], x = p[q+1]; if (x < 0) out.push(R[0], R[1], R[2]); else out.push(R[3*x], R[3*x+1], R[3*x+2]); }
  };
  for (let r = 0; r + 1 < rings.length; r++) { // zip the two rings by their position along the loop
    const O = rings[r], I = rings[r+1], no = O.length / 3, ni = I.length / 3;
    for (let i = 0, j = 0; i < no || j < ni;) {
      if (j >= ni || (i < no && (i + 1) / no <= (j + 1) / ni)) { tri(O, (i + 1) % no, O, i, I, j % ni); i++; }
      else { tri(O, i % no, I, j, I, (j + 1) % ni); j++; }
    }
  }
  const I = rings[rings.length - 1], n = I.length / 3;
  for (let a = 0; a < n; a++) { const b = (a + 1) % n; tri(I, b, I, a, c, -1); }
}
// World-space triangles closing one planned loop of part `own`.
function planTris(pl, ctx, out = []) {
  const { lp, own, nb, kind } = pl, n = lp.length, M = ctx.mat(own), flip = !!M && M.determinant() < 0, t3 = new THREE.Vector3();
  const ring0 = new Float32Array(3 * n);
  lp.forEach(([a], j) => ctx.wpos(own, a, t3).toArray(ring0, 3 * j));
  const cen = (R) => { const c = [0, 0, 0]; for (let j = 0; j < n; j++) for (let k = 0; k < 3; k++) c[k] += R[3*j+k] / n; return c; };
  if (kind === "pocket") { for (const x of pl.tris) out.push(x); return out; }
  if (kind === "fan" || kind === "under") { ringTris([ring0], cen(ring0), flip, out); return out; }
  if (kind === "patch") {
    const cntF = (l) => (l > 0 ? partCountsCached(ctx)[l] : 0);
    // the bigger side continues its surface; the smaller gets a flat face. So does the bigger side while the neighbor is
    // still seated on the cut (e.g. turned on its joint): a curved patch would bulge up through the neighbor's base.
    const fitL = cntF(own) >= cntF(nb) && !seatedOn(lp, own, nb, ctx) ? own : -1;
    const P = patchRings(lp, fitL, ctx.hash), rings = [ring0];
    // interior points ride with the part; the loop's own offset (heal) fades out toward the center
    const off = lp.map(([a]) => { const o = new THREE.Vector3(S.pos[3*a], S.pos[3*a+1], S.pos[3*a+2]); if (M) o.applyMatrix4(M); return ctx.wpos(own, a, new THREE.Vector3()).sub(o); });
    P.rings.forEach((R, k) => {
      const W = new Float32Array(R.length), t = P.t[k], ix = P.idx[k];
      for (let j = 0; j < ix.length; j++) { t3.fromArray(R, 3*j); if (M) t3.applyMatrix4(M); t3.addScaledVector(off[ix[j]], t); t3.toArray(W, 3*j); }
      rings.push(W);
    });
    const c = new THREE.Vector3(...P.c); if (M) c.applyMatrix4(M);
    // a curved patch stays under the neighbor's moved cut while the neighbor is still over the hole (lifted a little),
    // so it never pokes up through the neighbor
    const cap = fitL === own ? cutPlaneOver(lp, own, nb, ctx) : null;
    if (cap) {
      const under = (v) => { const d = v.clone().sub(cap.C).dot(cap.N); if (d > 0) v.addScaledVector(cap.N, -d); return v; };
      for (let k = 1; k < rings.length; k++) { const W = rings[k]; for (let j = 0; j < W.length; j += 3) under(t3.fromArray(W, j)).toArray(W, j); }
      under(c);
    }
    ringTris(rings, c.toArray(), flip, out); return out;
  }
  // bridge: sweep the cut from the neighbor's rim (t = 0) to this part's moved cut (t = 1) along the relative turn
  const Mn = ctx.mat(nb), Rel = (M ? M.clone() : new THREE.Matrix4()).multiply(Mn ? Mn.clone().invert() : new THREE.Matrix4());
  const p0 = lp.map(([a]) => ctx.wpos(nb, a)), p1 = lp.map(([a]) => ctx.wpos(own, a));
  const C0 = new THREE.Vector3(); p0.forEach((p) => C0.add(p)); C0.divideScalar(n);
  const C1 = C0.clone().applyMatrix4(Rel), q = new THREE.Quaternion(); Rel.decompose(new THREE.Vector3(), q, new THREE.Vector3());
  const Lm = new THREE.Matrix3().setFromMatrix4(Rel), Km = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q)).transpose().multiply(Lm);
  const res = p1.map((p, j) => p.clone().sub(p0[j].clone().applyMatrix4(Rel))); // heal / stretch beyond the rigid turn
  let per = 0, md = 0; for (let j = 0; j < n; j++) { per += p0[j].distanceTo(p0[(j+1) % n]); md = Math.max(md, p0[j].distanceTo(p1[j])); }
  const ang = 2 * Math.acos(Math.min(1, Math.abs(q.w))), steps = Math.max(1, Math.min(24, Math.max(Math.ceil(ang / 0.14), Math.ceil(md / Math.max(3 * per / n, 1e-6)))));
  // The two ends are the cut loops as they are (they meet the parts' edges); the rings between sweep a smoothed copy, as
  // a cut zigzags along mesh edges and the zigzag swept along would show as ridges.
  const flat = (A) => { const F = new Float64Array(3 * n); A.forEach((v, j) => v.toArray(F, 3*j)); return F; };
  const D0 = flat(p0.map((p) => p.clone().sub(C0))), Rs = flat(res), hs = Math.max(1, Math.round(n / 60));
  const Ds = loopSmooth(D0, hs), Rss = loopSmooth(Rs, hs);
  const rings = [ring0], I = new THREE.Quaternion(), qt = new THREE.Quaternion(), d = new THREE.Vector3(), kd = new THREE.Vector3(), r3 = new THREE.Vector3();
  for (let k = 1; k <= steps; k++) {
    const t = 1 - k / steps, R = new Float32Array(3 * n), end = k === steps, Dk = end ? D0 : Ds, Rk = end ? Rs : Rss; qt.slerpQuaternions(I, q, t);
    for (let j = 0; j < n; j++) {
      d.fromArray(Dk, 3*j); kd.copy(d).applyMatrix3(Km);
      t3.copy(d).lerp(kd, t).applyQuaternion(qt).add(C0.clone().lerp(C1, t)).addScaledVector(r3.fromArray(Rk, 3*j), t).toArray(R, 3*j);
    }
    rings.push(R);
  }
  // cap over the neighbor's hole: rings shrinking to the center, each smoothed more (one fan from the zigzag loop to the
  // center would show as a pie)
  const ed = per / n, rb = D0.reduce((m, _, i) => (i % 3 ? m : m + Math.hypot(D0[i], D0[i+1], D0[i+2]) / n), 0);
  const Kc = Math.max(2, Math.min(6, Math.round(rb / Math.max(3 * ed, 1e-6))));
  for (const t of [1 - 0.3 / Kc, ...Array.from({ length: Kc - 1 }, (_, k) => 1 - (k + 1) / Kc)]) {
    const Ls = loopSmooth(D0, Math.round((1 - t) * rb / Math.max(ed, 1e-6))), R = new Float32Array(3 * n);
    for (let j = 0; j < n; j++) { R[3*j] = C0.x + t * Ls[3*j]; R[3*j+1] = C0.y + t * Ls[3*j+1]; R[3*j+2] = C0.z + t * Ls[3*j+2]; }
    rings.push(R);
  }
  ringTris(rings, C0.toArray(), flip, out); return out;
}
function partCountsCached(ctx) { return (ctx.cnt ||= partCounts()); }
// Is part nb's moved cut still in the plane of part own's side of loop lp (turned in place on its joint, not lifted
// or tilted off it)? Compared with the loop's own out-of-plane spread, so a cut on a curved surface still counts.
function seatedOn(lp, own, nb, ctx) {
  if (!(nb > 0)) return false;
  const n = lp.length, P = lp.map(([a]) => ctx.wpos(own, a)), Q = lp.map(([a]) => ctx.wpos(nb, a)), C = new THREE.Vector3(), N = new THREE.Vector3();
  P.forEach((p) => C.add(p)); C.divideScalar(n);
  let r = 0;
  for (let k = 0; k < n; k++) { const a = P[k].clone().sub(C), b = P[(k+1) % n].clone().sub(C); N.add(a.cross(b)); r += P[k].distanceTo(C); }
  if (N.lengthSq() < 1e-18) return false;
  N.normalize(); r /= n;
  const spread = (pts) => pts.reduce((m, p) => Math.max(m, Math.abs(p.clone().sub(C).dot(N))), 0);
  return spread(Q) <= spread(P) + 0.03 * r;
}
// The plane of part nb's moved cut ({C, N}, N pointing away from part own) while that cut still sits over own's side
// of loop lp: its center within a loop radius of the hole's. Else null (nb moved clear of the hole).
function cutPlaneOver(lp, own, nb, ctx) {
  if (!(nb > 0)) return null;
  const n = lp.length, P = lp.map(([a]) => ctx.wpos(own, a)), Q = lp.map(([a]) => ctx.wpos(nb, a));
  const Cp = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), Np = new THREE.Vector3();
  P.forEach((p) => Cp.add(p)); Cp.divideScalar(n); Q.forEach((q) => C.add(q)); C.divideScalar(n);
  let r = 0;
  for (let k = 0; k < n; k++) {
    Np.add(P[k].clone().sub(Cp).cross(P[(k+1) % n].clone().sub(Cp))); N.add(Q[k].clone().sub(C).cross(Q[(k+1) % n].clone().sub(C)));
    r += P[k].distanceTo(Cp);
  }
  r /= n;
  if (N.lengthSq() < 1e-18 || Np.lengthSq() < 1e-18 || C.distanceTo(Cp) > r) return null;
  N.normalize(); Np.normalize();
  const b = partBox(nb), mid = new THREE.Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2), Mn = ctx.mat(nb);
  if (Mn) mid.applyMatrix4(Mn);
  if (mid.sub(C).dot(N) < 0) N.negate(); // toward the neighbor's body
  return { C, N };
}
// Closing triangles for every loop of part i (or of the unchanged rest, in mergedSoup), world space.
function capTris(plans, ctx) { const out = []; for (const pl of plans) planTris(pl, ctx, out); return Float32Array.from(out); }

// Display: the patches and sleeves of open gaps, drawn as their own mesh in the parts' colors.
let fillMesh = null;
function updateFillMesh() {
  if (fillMesh) { scene.remove(fillMesh); fillMesh.geometry.dispose(); fillMesh = null; }
  if (!mesh || !S.G) return;
  const ch = changedParts(); if (!ch.size) return;
  const ctx = fillCtx(), nb = neighborPairs(), involved = new Set();
  for (const k of nb) { const [a, b] = k.split("|").map(Number); if (ch.has(a) || ch.has(b)) { involved.add(a); involved.add(b); } }
  const pos = [], own = [];
  for (const l of involved) {
    const p = S.parts[l]; if (!p || p.visible === false || hasRep(p) || trimMeshes.has(l)) continue; // a trimmed part's caps are in its trim mesh
    for (const pl of loopPlans(partLoops(l, ctx), ctx)) {
      if (pl.kind !== "patch" && pl.kind !== "bridge") continue;
      const n0 = pos.length; planTris(pl, ctx, pos); for (let k = n0; k < pos.length; k += 9) own.push(l);
    }
  }
  if (!pos.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(pos), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(pos.length), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(smoothNormals(geo.getAttribute("position").array), 3));
  fillMesh = new THREE.Mesh(geo, material); fillMesh.userData.own = own; fillMesh.raycast = () => {};
  scene.add(fillMesh); colorFillMesh();
}
function colorFillMesh(plain = false) {
  if (!fillMesh) return;
  const col = fillMesh.geometry.getAttribute("color").array, own = fillMesh.userData.own, cs = new Map();
  own.forEach((l, t) => { if (!cs.has(l)) cs.set(l, shownColor(l, plain).convertSRGBToLinear()); const c = cs.get(l); for (let k = 0; k < 9; k += 3) { col[9*t+k] = c.r; col[9*t+k+1] = c.g; col[9*t+k+2] = c.b; } });
  fillMesh.geometry.getAttribute("color").needsUpdate = true;
}
const posKey = (P, o) => `${Math.round(P[o]*1e3)},${Math.round(P[o+1]*1e3)},${Math.round(P[o+2]*1e3)}`;
function smoothNormals(P) { // vertex normals averaged over triangles that share a position
  const N = new Float32Array(P.length), acc = new Map(), key = (o) => posKey(P, o);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let o = 0; o < P.length; o += 9) {
    a.fromArray(P, o); b.fromArray(P, o+3); c.fromArray(P, o+6);
    const f = b.clone().sub(a).cross(c.clone().sub(a));
    for (let k = 0; k < 9; k += 3) { const kk = key(o+k); const v = acc.get(kk); if (v) v.add(f); else acc.set(kk, f.clone()); }
  }
  for (let o = 0; o < P.length; o += 3) { const v = acc.get(key(o)).clone().normalize(); N[o] = v.x; N[o+1] = v.y; N[o+2] = v.z; }
  return N;
}
// What happens at the cut of parts js when they move: "open" (the default: the gap shows), "fill" or "anchor".
function setGap(js, mode) {
  js = js.filter((j) => j > 0 && S.parts[j] && !hasRep(S.parts[j]));
  if (!js.length) return;
  pushUndo();
  for (const j of js) { delete S.parts[j].anchor; delete S.parts[j].fill; if (mode === "anchor") S.parts[j].anchor = true; else if (mode === "fill") S.parts[j].fill = true; }
  const names = js.map((j) => S.parts[j].name).join(", "), s = js.length > 1 ? "" : "s";
  afterEdit(mode === "anchor" ? `Anchor: ${names} stay${s} joined to the body; the gap fills with new material`
    : mode === "fill" ? `Fill: the holes ${names} leave${s} are patched` : `Open: the gaps ${names} leave${s} show as cut`);
}
const setAnchor = (js, on) => setGap(js, on ? "anchor" : "fill"); // Anchor, or Fill

// ---------------------------------------------------------------- trim
// part.trim: a moved part loses whatever ends up inside other parts, e.g. a foot slid in under the body is cut off
// where it would poke into the body. The other parts keep their shape (a Fill patch on the neighbor counts as its
// surface). Works on the closed solids (partSoup), so the display, Part STLs, the 3MFs and the Merged STL all match.
const trimMeshes = new Map(); // part index -> trimmed display mesh (the part's faces in the main mesh are hidden)
const trimCache = new Map();
let trimTimer = 0;
const trimOn = (i) => i > 0 && !!S.parts[i]?.trim && !hasRep(S.parts[i]) && !isIdXf(S.parts[i].xf) && S.parts[i].visible !== false;
function worldBox(v) {
  const b = new THREE.Box3(); for (let o = 0; o < v.length; o += 3) b.expandByPoint(new THREE.Vector3(v[o], v[o+1], v[o+2])); return b;
}
// The part's closed solid minus every other visible part whose box meets it: { pos, nrm } (world, triangle soup).
function trimResult(i) {
  const key = `${xfKey}|${i}`;
  if (trimCache.has(key)) return trimCache.get(key);
  if (trimCache.size > 16) trimCache.clear();
  let out = null;
  const A = partSoup(i, true);
  if (A?.length) {
    const box = worldBox(A), cnt = partCounts(), ev = new Evaluator();
    ev.attributes = ["position", "normal"]; ev.useGroups = false;
    const brush = (v) => {
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(v, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(smoothNormals(v), 3));
      const b = new Brush(g); b.updateMatrixWorld(); return b;
    };
    let R = brush(A), cut = 0;
    S.parts.forEach((q, j) => {
      if (j === i || j === 0 || q.visible === false || (!cnt[j] && !hasRep(q))) return;
      const B = partSoup(j, true); if (!B?.length || !worldBox(B).intersectsBox(box)) return;
      try { R = ev.evaluate(R, brush(B), SUBTRACTION); cut++; } catch (e) { console.warn(`trim ${q.name}:`, e); }
    });
    const g = R.geometry.index ? R.geometry.toNonIndexed() : R.geometry;
    const disp = Float32Array.from(g.getAttribute("position").array);
    out = { disp, nrm: Float32Array.from(g.getAttribute("normal").array), cut, get pos() { return (this._pos ||= cut ? closeTJunctions(disp, 1e-4).v : A); } };
  }
  trimCache.set(key, out); return out;
}
// The CSG result has T-junctions (a vertex of one triangle inside another's edge) along the cut. For export: weld
// it, then split those triangles at the vertices on their open edges, so the part is a closed solid again.
function snapWeld(v, tol) { // move vertices within tol of an earlier one onto it; drop triangles that collapse
  const g = new Map(), out = [], c = (x) => Math.floor(x / tol), rep = new Float32Array(3);
  const find = (x, y, z) => {
    const i = c(x), j = c(y), k = c(z);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) for (const p of g.get(`${i+a},${j+b},${k+d}`) || [])
      if ((p[0]-x)**2 + (p[1]-y)**2 + (p[2]-z)**2 <= tol*tol) return p;
    const p = [x, y, z], key = `${i},${j},${k}`; if (!g.has(key)) g.set(key, []); g.get(key).push(p); return p;
  };
  for (let o = 0; o < v.length; o += 9) {
    const P = [find(v[o], v[o+1], v[o+2]), find(v[o+3], v[o+4], v[o+5]), find(v[o+6], v[o+7], v[o+8])];
    if (P[0] === P[1] || P[1] === P[2] || P[0] === P[2]) continue;
    out.push(...P[0], ...P[1], ...P[2]);
  }
  return Float32Array.from(out);
}
function closeTJunctions(v, tol) {
  v = snapWeld(v, tol);
  for (let pass = 0; pass < 4; pass++) {
    const key = (o) => `${v[o]},${v[o+1]},${v[o+2]}`; // welded: equal points are exactly equal
    const E = new Map(), K = [];
    for (let o = 0; o < v.length; o += 9) { const k = [key(o), key(o+3), key(o+6)]; K.push(k); for (let e = 0; e < 3; e++) { const ab = k[e] + "|" + k[(e+1)%3]; E.set(ab, (E.get(ab) || 0) + 1); } }
    const open = []; const bv = new Map();
    K.forEach((k, t) => { for (let e = 0; e < 3; e++) if (!E.has(k[(e+1)%3] + "|" + k[e])) { open.push([t, e]); for (const c of [e, (e+1)%3]) bv.set(k[c], 9*t + 3*c); } });
    if (!open.length) return { v, open: 0 };
    // grid of boundary vertices
    const cell = 50 * tol, g = new Map(), gk = (x, y, z) => `${Math.floor(x/cell)},${Math.floor(y/cell)},${Math.floor(z/cell)}`;
    for (const [k, o] of bv) { const c = gk(v[o], v[o+1], v[o+2]); if (!g.has(c)) g.set(c, []); g.get(c).push(o); }
    const split = new Map(); // tri -> [[e, [t params, offsets]]]
    let found = 0;
    for (const [t, e] of open) {
      const a = 9*t + 3*e, b = 9*t + 3*((e+1)%3);
      const ax = v[a], ay = v[a+1], az = v[a+2], dx = v[b]-ax, dy = v[b+1]-ay, dz = v[b+2]-az, L2 = dx*dx+dy*dy+dz*dz;
      if (L2 < tol*tol) continue;
      const pts = [];
      const lo = [Math.min(ax, v[b]), Math.min(ay, v[b+1]), Math.min(az, v[b+2])].map((x) => Math.floor((x - 2*tol)/cell));
      const hi = [Math.max(ax, v[b]), Math.max(ay, v[b+1]), Math.max(az, v[b+2])].map((x) => Math.floor((x + 2*tol)/cell));
      if ((hi[0]-lo[0]+1)*(hi[1]-lo[1]+1)*(hi[2]-lo[2]+1) > 4096) { // long edge: scan all
        for (const o of bv.values()) test(o);
      } else for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) for (const o of g.get(`${i},${j},${k}`) || []) test(o);
      function test(o) {
        const px = v[o]-ax, py = v[o+1]-ay, pz = v[o+2]-az, s = (px*dx+py*dy+pz*dz) / L2;
        if (s <= 1e-6 || s >= 1 - 1e-6) return;
        const ex = px - s*dx, ey = py - s*dy, ez = pz - s*dz;
        if (ex*ex+ey*ey+ez*ez > 4*tol*tol) return;
        const kk = key(o); if (kk === key(a) || kk === key(b)) return;
        pts.push([s, o]);
      }
      if (!pts.length) continue;
      pts.sort((x, y) => x[0] - y[0]); found++;
      if (!split.has(t)) split.set(t, [[], [], []]);
      split.get(t)[e] = pts.filter((p, i) => !i || key(p[1]) !== key(pts[i-1][1])).map((p) => p[1]);
    }
    if (!found) return { v, open: open.length };
    const out = [];
    for (let t = 0, o = 0; o < v.length; o += 9, t++) {
      const sp = split.get(t);
      if (!sp) { for (let k = 0; k < 9; k++) out.push(v[o+k]); continue; }
      const poly = []; for (let e = 0; e < 3; e++) { poly.push([v[o+3*e], v[o+3*e+1], v[o+3*e+2]]); for (const p of sp[e]) poly.push([v[p], v[p+1], v[p+2]]); }
      const c = [0, 1, 2].map((k) => (v[o+k] + v[o+3+k] + v[o+6+k]) / 3);
      for (let i = 0; i < poly.length; i++) out.push(...c, ...poly[i], ...poly[(i+1) % poly.length]);
    }
    v = Float32Array.from(out);
  }
  return { v, open: -1 };
}

function clearTrimMeshes() {
  if (!trimMeshes.size) return;
  for (const m of trimMeshes.values()) { scene.remove(m); m.geometry.dispose(); }
  trimMeshes.clear(); updateVisibility();
}
function scheduleTrim() {
  clearTimeout(trimTimer);
  if (!S.parts.some((_, i) => trimOn(i))) return;
  trimTimer = setTimeout(updateTrim, gizmo?.dragging ? 250 : 0);
}
function updateTrim() {
  clearTrimMeshes();
  if (!mesh || !S.G) return;
  S.parts.forEach((p, i) => {
    if (!trimOn(i)) return;
    const t = trimResult(i); if (!t?.disp.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(t.disp, 3)); g.setAttribute("normal", new THREE.BufferAttribute(t.nrm, 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(t.disp.length), 3));
    g.computeBoundsTree();
    const m = new THREE.Mesh(g, material); // the main mesh's material and vertex colors, so the part keeps its exact color
    m.userData.part = i; trimMeshes.set(i, m); scene.add(m);
  });
  updateVisibility(); updateFillMesh(); updateColors();
}
function setTrim(js, on) {
  js = js.filter((j) => j > 0 && S.parts[j] && !hasRep(S.parts[j]));
  if (!js.length) return;
  pushUndo();
  for (const j of js) { if (on) S.parts[j].trim = true; else delete S.parts[j].trim; }
  const names = js.map((j) => S.parts[j].name).join(", ");
  afterEdit(on ? `Trim: ${names} ${js.length > 1 ? "are" : "is"} cut where ${js.length > 1 ? "they overlap" : "it overlaps"} other parts (after a move)` : `Trim off on ${names}`);
}
// The original face of part i nearest a world point (clicks on a trimmed part select / act on that part).
function nearestFace(i, w) {
  const M = xfMatrix(S.parts[i]), p = M ? w.clone().applyMatrix4(M.clone().invert()) : w;
  let best = -1, bd = Infinity;
  for (let f = 0; f < S.nF; f++) {
    if (S.labels[f] !== i) continue;
    const a = 3 * S.tri[3*f], b = 3 * S.tri[3*f+1], c = 3 * S.tri[3*f+2];
    const x = (S.pos[a] + S.pos[b] + S.pos[c]) / 3 - p.x, y = (S.pos[a+1] + S.pos[b+1] + S.pos[c+1]) / 3 - p.y, z = (S.pos[a+2] + S.pos[b+2] + S.pos[c+2]) / 3 - p.z;
    const d = x*x + y*y + z*z; if (d < bd) { bd = d; best = f; }
  }
  return best;
}

function filColor(n) { return orcaFil?.[n - 1] || S.parts.find((q) => q.filament === n)?.color || "#666"; }
let orcaFil = null; // OrcaSlicer's filament colors by slot (plugin), used by the filament view
let byFilament = false; try { byFilament = localStorage.getItem("meshsplit:byFil") === "1"; } catch {}
// Display color of part i: its own color, or (filament view) the color of the first part on the same slot.
function shownColor(i, plain) {
  const p = S.parts[i];
  let c = p.color;
  if (byFilament && !plain) { const q = S.parts.find((q) => q.filament === p.filament); if (q) c = q.color; if (orcaFil?.[p.filament - 1]) c = orcaFil[p.filament - 1]; }
  const col = new THREE.Color(c);
  if (!plain && i === S.active && i > 0) col.lerp(new THREE.Color(0xffffff), 0.45); // selected part reads lighter
  return col;
}
function updateColors(plain = false) {
  if (!mesh) return;
  colorFillMesh(plain);
  const col = mesh.geometry.getAttribute("color").array;
  const cs = S.parts.map((_, i) => shownColor(i, plain).convertSRGBToLinear());
  for (const m of repMeshes.values()) if (S.parts[m.userData.part]) m.material.color.copy(shownColor(m.userData.part, plain));
  for (const [i, m] of trimMeshes) if (S.parts[i]) { const c = shownColor(i, plain).convertSRGBToLinear(), a = m.geometry.getAttribute("color"); for (let k = 0; k < a.count; k++) a.setXYZ(k, c.r, c.g, c.b); a.needsUpdate = true; }
  for (let f = 0; f < S.nF; f++) {
    const c = cs[S.labels[f]] || cs[0];
    for (let k = 0; k < 3; k++) { col[9*f+3*k] = c.r; col[9*f+3*k+1] = c.g; col[9*f+3*k+2] = c.b; }
  }
  mesh.geometry.getAttribute("color").needsUpdate = true;
  render();
}

let visKey = "";
function updateVisibility() {
  if (!mesh) return;
  const vis = S.parts.map((p, i) => p.visible && !(p.rep && REPS.has(p.rep.id)) && !trimMeshes.has(i));
  const key = vis.join(",") + "|" + (vis.every(Boolean) ? "" : hashLabels());
  if (key === visKey && mesh.geometry.boundsTree) return;
  visKey = key;
  const idx = [];
  for (let f = 0; f < S.nF; f++) if (vis[S.labels[f]] !== false) idx.push(3*f, 3*f+1, 3*f+2);
  const geo = mesh.geometry;
  geo.disposeBoundsTree?.();
  geo.setIndex(idx.length ? idx : [0, 0, 0]);
  geo.computeBoundsTree();
  render();
}
function fullHash() { let h = 0; for (let f = 0; f < S.nF; f++) h = (h * 31 + S.labels[f]) | 0; return h; }
function hashLabels() { let h = 0; for (let f = 0; f < S.nF; f += 7) h = (h * 31 + S.labels[f]) | 0; return h; }

function drawSeeds() {
  seedGroup.clear();
  if (!S.G) return;
  const r = S.G.diag * 0.006, sg = new THREE.SphereGeometry(r, 12, 8), outline = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
  S.parts.forEach((p, i) => {
    if (!p.visible) return;
    const m = new THREE.MeshBasicMaterial({ color: p.color }), M = xfMatrix(p);
    for (const f of p.seeds) {
      const pos = new THREE.Vector3(S.G.cen[3*f], S.G.cen[3*f+1], S.G.cen[3*f+2]);
      if (M) pos.applyMatrix4(M);
      const s = new THREE.Mesh(sg, m); s.position.copy(pos);
      const o = new THREE.Mesh(sg, outline); o.scale.setScalar(1.35); o.position.copy(pos);
      seedGroup.add(o, s);
    }
  });
  render();
}

// Print plate under the model, like OrcaSlicer's: 256 mm (an X1/P1 bed) or larger, under the model's footprint
// with its top at the model's lowest point. Display only: the mesh and every export keep their coordinates.
let plate = null;
function updatePlate() {
  if (plate) { scene.remove(plate); plate.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); plate = null; }
  if (!S.G) return;
  const b = S.G.bbox, size = Math.max(256, Math.ceil(Math.max(b[3] - b[0], b[4] - b[1]) / 10) * 10 + 20);
  plate = new THREE.Group();
  const base = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ color: 0x3E3E45, roughness: 0.95, metalness: 0 }));
  base.position.z = -0.3;
  const grid = new THREE.GridHelper(size, size / 10, 0x6A6A73, 0x55555E);
  grid.rotation.x = Math.PI / 2;
  plate.add(base, grid);
  plate.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, b[2]);
  scene.add(plate);
}
function frame() {
  const b = S.G.bbox, c = new THREE.Vector3((b[0]+b[3])/2, (b[1]+b[4])/2, (b[2]+b[5])/2), d = S.G.diag;
  controls.target.copy(c);
  camera.near = d / 1000; camera.far = d * 20;
  camera.position.set(c.x + d * 0.55, c.y - d * 1.25, c.z + d * 0.45);
  camera.updateProjectionMatrix(); controls.update(); render();
}

// Keep the view direction, center on box b and fit it.
function frameBox(b) {
  if (!isFinite(b[0])) return;
  const c = new THREE.Vector3((b[0]+b[3])/2, (b[1]+b[4])/2, (b[2]+b[5])/2), d = Math.max(1e-3, Math.hypot(b[3]-b[0], b[4]-b[1], b[5]-b[2]));
  const dir = camera.position.clone().sub(controls.target).normalize();
  controls.target.copy(c); camera.position.copy(c).addScaledVector(dir, d * 2.2);
  camera.updateProjectionMatrix(); controls.update(); render();
}

// ---------------------------------------------------------------- picking & tools
const ray = new THREE.Raycaster(); ray.firstHitOnly = true;
function hit(ev) {
  if (!mesh) return null;
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
  let h = ray.intersectObject(mesh, false)[0];
  const th = trimMeshes.size ? ray.intersectObjects([...trimMeshes.values()], false)[0] : null;
  if (th && (!h || th.distance < h.distance)) h = { ...th, face: { ...th.face, a: 3 * nearestFace(th.object.userData.part, th.point) } };
  if (!h) return null;
  const face = Math.floor(h.face.a / 3), M = xfMatrix(S.parts[S.labels[face]]);
  // tools work in the original mesh space; the brush ring is drawn at the world hit
  const point = M ? h.point.clone().applyMatrix4(M.clone().invert()) : h.point;
  return { face, point, world: h.point, wn: h.face.normal };
}

const TOOLS = [
  { id: "orbit", key: "v", icon: "pick", title: "Select (V), click a part to select it, drag rotate, right-drag pan, wheel zoom" },
  { id: "seed", key: "s", icon: "seed", title: "Seed (S), click adds a seed to the active part, Alt+click removes nearest" },
  { id: "fill", key: "f", icon: "fill", title: "Fill (F), flood the clicked region up to the fill-stop crease into the active part" },
  { id: "brush", key: "b", icon: "brush", title: "Brush (B), Shift erases, right-drag rotates" },
];
document.querySelectorAll("[data-tools]").forEach((g) => [...g.dataset.tools.split(",")].reverse().forEach((id) => {
  const t = TOOLS.find((t) => t.id === id), b = document.createElement("button");
  b.dataset.tool = t.id; b.title = t.title; b.innerHTML = icon(t.icon);
  b.onclick = () => setTool(t.id);
  g.prepend(b);
}));
function setTool(t) {
  S.tool = t;
  document.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === t));
  if (t === "seed") showSplit(true, "seeds");
  else if (t === "fill" || t === "brush") showSplit(true, "paint");
  queueMicrotask(() => syncGizmo()); // the gizmo shows with the Select tool only
}

let down = null, painting = false;
const canvas = renderer.domElement;
let rdown = null;
// Block the browser's own menu (Back/Refresh/Save as/Print) everywhere but text fields. It can't be done on the
// canvas alone: on Windows (OrcaSlicer's WebView2) contextmenu fires after pointerup, which already opened our
// menu under the cursor, so the event lands on #ctxMenu instead of the canvas.
document.addEventListener("contextmenu", (ev) => { if (!ev.target.closest?.("input, textarea, [contenteditable]")) ev.preventDefault(); });
canvas.addEventListener("pointerdown", (ev) => {
  if (ev.button === 2) { rdown = { x: ev.clientX, y: ev.clientY }; return; }
  closeCtx();
  if (ev.button !== 0 || !mesh) return;
  if (gizmo.object && gizmo.axis) { down = null; return; } // on a gizmo handle: the gizmo owns this drag
  down = { x: ev.clientX, y: ev.clientY };
  if (S.tool === "brush" && !ev.ctrlKey && !placing) {
    const h = hit(ev);
    if (h) {
      controls.enabled = false; painting = true; pushUndo();
      if (brushAt(h.face, h.point, ev.shiftKey ? 0 : S.active)) updateColors();
    }
  }
});
canvas.addEventListener("pointermove", (ev) => {
  if (!mesh) return;
  const h = hit(ev);
  if (placing) { showGhost(h, ev); return; }
  if (painting && h) { if (brushAt(h.face, h.point, ev.shiftKey ? 0 : S.active)) updateColors(); }
  if (h) {
    const p = S.parts[S.labels[h.face]];
    status(`${p.name}  ·  F${p.filament}  ·  face ${h.face}`);
    showBrush(S.tool === "brush" ? h : null);
  } else showBrush(null);
});
window.addEventListener("pointerup", (ev) => {
  if (ev.button === 2 && rdown) { // right click without drag (right-drag pans)
    const still = Math.hypot(ev.clientX - rdown.x, ev.clientY - rdown.y) <= 4; rdown = null;
    if (still && ev.target === canvas && !placing) openCtx(ev);
    return;
  }
  if (painting) { painting = false; controls.enabled = true; dropEmptyParts(); afterEdit(); }
  if (!down || ev.button !== 0) return;
  const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4; down = null;
  if (moved || ev.target !== canvas) return;
  if (pickingJoint) { pickJointAt(ev); return; }
  if (placing) { const h = hit(ev); if (h) placeAt(h); return; }
  const h = hit(ev);
  if (!h) { if (S.tool === "orbit" && S.active) selectPart(0); return; }
  if ((ev.shiftKey && S.tool === "orbit") || (ev.ctrlKey && ev.shiftKey)) { toggleSel(S.labels[h.face]); return; }
  if (ev.ctrlKey || S.tool === "orbit") { selectPart(S.labels[h.face]); return; }
  if (S.tool === "seed") {
    if (ev.altKey) { removeNearestSeed(h.face); return; }
    if (S.active === 0) { pushUndo(); S.parts.push(newPart()); S.active = S.parts.length - 1; }
    else pushUndo();
    S.parts[S.active].seeds.push(h.face);
    afterEdit(`Seed added to ${S.parts[S.active].name}`);
  } else if (S.tool === "fill") fillFrom(h.face);
});
function removeNearestSeed(f0) {
  const c = S.G.cen; let best = null, bd = Infinity;
  S.parts.forEach((p, i) => p.seeds.forEach((f, j) => {
    const d = Math.hypot(c[3*f]-c[3*f0], c[3*f+1]-c[3*f0+1], c[3*f+2]-c[3*f0+2]);
    if (d < bd) { bd = d; best = [i, j]; }
  }));
  if (!best) return;
  pushUndo(); S.parts[best[0]].seeds.splice(best[1], 1); afterEdit("Seed removed");
}
function showBrush(h) {
  if (!h) { if (brushRing) { brushRing.visible = false; render(); } return; }
  if (!brushRing) {
    brushRing = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, side: THREE.DoubleSide }));
    brushRing.renderOrder = 3; scene.add(brushRing);
  }
  const r = +$("brushR").value, n = h.wn.clone().normalize();
  brushRing.visible = true; brushRing.scale.setScalar(r);
  brushRing.position.copy(h.world);
  brushRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  render();
}
function status(t) { $("status").textContent = t; }

// ---------------------------------------------------------------- UI
function syncSliders() {
  $("lambdaOut").textContent = $("lambda").value + "°";
  $("smoothOut").textContent = $("smooth").value;
  $("fillAngOut").textContent = $("fillAng").value + "°";
  $("brushROut").textContent = (+$("brushR").value).toFixed(1);
}
["lambda", "smooth", "fillAng", "brushR"].forEach((id) => $(id).addEventListener("input", syncSliders));

let lastActive = -1;
const mergeSel = new Set(); // parts Shift+clicked in the list, merged into the selected part
function selectPart(i) { if (flow && flow.part !== i) closeFlow(); S.active = i; mergeSel.clear(); refreshUI(); }
// Parts list motion. Each part keeps a row key across re-renders and undo (kept beside the part, not in it, so
// sessions don't change). After a re-render, new rows fade in, removed rows fade out where they were, and the
// other rows glide from their old place to the new one (FLIP), instead of the list jumping.
const rowKeys = new WeakMap();
let rowSeq = 0;
function rowKey(p) { let k = rowKeys.get(p); if (!k) rowKeys.set(p, (k = ++rowSeq)); return k; }
const motionOK = () => !matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE = "cubic-bezier(.2, .8, .3, 1)";
// Rows are reused by key (not rebuilt), so a row's animation survives the many re-renders an edit triggers.
function animateRows(body, before) {
  if (!before || !motionOK() || !body.isConnected) return;
  let added = 0;
  for (const tr of body.children) {
    const old = before.get(tr.dataset.k);
    if (old) {
      before.delete(tr.dataset.k);
      tr.getAnimations().forEach((a) => a.id === "flip" && a.cancel());
      const dy = old.top - tr.getBoundingClientRect().top;
      if (Math.abs(dy) > 0.5) tr.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { id: "flip", duration: 200, easing: EASE });
    } else {
      tr.animate([{ opacity: 0, transform: "translateX(-12px)" }, { opacity: 1, transform: "none" }],
        { id: "in", duration: 220, easing: "ease-out", delay: Math.min(added++, 8) * 35, fill: "backwards" });
    }
  }
  for (const { tr, rect } of before.values()) { // removed: the old row fades out on top of where it was
    const t = document.createElement("table"); t.className = "parts ghost";
    Object.assign(t.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px` });
    tr.getAnimations().forEach((a) => a.cancel());
    t.appendChild(document.createElement("tbody")).appendChild(tr);
    document.body.appendChild(t);
    t.animate([{ opacity: 1 }, { opacity: 0, transform: "translateX(-12px)" }], { duration: 160, easing: "ease-in", fill: "forwards" }).onfinish = () => t.remove();
  }
}
function refreshUI() {
  const body = $("partsBody");
  const rows = new Map(), before = motionOK() && body.children.length ? new Map() : null;
  for (const tr of body.children) {
    rows.set(tr.dataset.k, tr);
    if (before) { const rect = tr.getBoundingClientRect(); before.set(tr.dataset.k, { tr, rect, top: rect.top }); }
  }
  if (!S.G) body.innerHTML = "";
  document.body.classList.toggle("empty", !S.G);
  if (!S.G) return;
  const solo = isSolo(S.active);
  $("soloBtn").classList.toggle("on", solo); $("soloBtn").title = solo ? "Show all parts again" : "Show only this part";
  const cnt = partCounts();
  for (const i of [...mergeSel]) if (i <= 0 || i >= S.parts.length || i === S.active) mergeSel.delete(i);
  S.parts.forEach((p, i) => {
    if (i === 0 && !cnt[0]) return; // Unassigned is listed only while some faces are unassigned
    const key = String(rowKey(p)), tr = rows.get(key) || document.createElement("tr");
    rows.delete(key);
    tr.className = i === S.active ? "active" : mergeSel.has(i) ? "msel" : "";
    tr.title = i ? "Click: select · Ctrl/Shift+click: select more · Right-click: actions" : "Click: select · Right-click: actions";
    tr.innerHTML = `<td><span class="sw" style="background:${p.color}"></span></td>
      <td class="nm">${esc(p.name)}</td>
      <td title="Filament slot"><span class="fil" style="background:${filColor(p.filament)}">${p.filament}</span></td>
      <td class="n">${cnt[i].toLocaleString()}${p.seeds.length ? ` · ${p.seeds.length}●` : ""}</td>
      <td><button class="eye" title="${p.visible ? "Hide" : "Show"}">${icon(p.visible ? "eye" : "eyeOff")}</button></td>`;
    tr.onclick = (ev) => {
      if (ev.target.closest(".eye")) return;
      if (ev.shiftKey || ev.ctrlKey || ev.metaKey) toggleSel(i); else selectPart(i);
    };
    tr.oncontextmenu = (ev) => {
      ev.preventDefault();
      if (i !== S.active && !mergeSel.has(i)) selectPart(i);
      openPartMenu(ev, i);
    };
    tr.querySelector(".eye").onclick = () => { p.visible = !p.visible; updateVisibility(); drawSeeds(); refreshUI(); };
    if (i) tr.querySelector(".nm").ondblclick = (ev) => { ev.stopPropagation(); startRename(i); };
    tr.dataset.part = i; tr.dataset.k = key;
    body.appendChild(tr); // appending a reused row moves it into its new place
  });
  for (const tr of rows.values()) tr.remove(); // rows of parts that are gone
  animateRows(body, before);
  if (lastActive !== S.active) { lastActive = S.active; updateColors(); }
  $("mergeBtn").hidden = !mergeSel.size;
  $("mergeBtn").title = `Merge ${mergeSel.size} part(s) into ${S.parts[S.active].name}`;
  refreshXfPanel();
  $("undoBtn").disabled = !S.hist.past.length;
  $("redoBtn").disabled = !S.hist.future.length;
}

// Inline rename in the parts list (double-click a name, or right-click > Rename).
function renamePart(i, name) {
  const p = S.parts[i]; name = (name || "").trim();
  if (!p || !name || name === p.name) return false;
  pushUndo(); p.name = name; autosave(); return true;
}
function startRename(i) {
  if (S.active !== i) selectPart(i);
  const td = document.querySelector(`#partsBody tr[data-part="${i}"] .nm`);
  if (!td) { $("pcName").focus(); $("pcName").select(); return; }
  const inp = document.createElement("input"); inp.type = "text"; inp.value = S.parts[i].name; inp.className = "nmEdit";
  td.textContent = ""; td.appendChild(inp);
  let done = false;
  const finish = (ok) => { if (done) return; done = true; if (ok) renamePart(i, inp.value); refreshUI(); };
  inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") finish(true); else if (e.key === "Escape") finish(false); };
  inp.onblur = () => finish(true);
  inp.onclick = inp.ondblclick = inp.onpointerdown = (e) => e.stopPropagation();
  inp.focus(); inp.select();
}

// ---------------------------------------------------------------- right-click menu
function closeCtx() { $("ctxMenu").hidden = true; }
function openCtx(ev) {
  const h = hit(ev); if (!h) { closeCtx(); return; }
  const f = h.face, l = S.labels[f], p = S.parts[l], act = S.active > 0 && S.active !== l ? S.parts[S.active] : null;
  const anyUn = S.labels.some((x) => x === 0);
  const items = [];
  const it = (ic, label, fn, cls = "") => items.push({ ic, label, fn, cls });
  if (l === 0) {
    it("fill", "Fill into nearest part", () => fillUnassigned(f));
    if (act) it("fill", `Fill into ${act.name}`, () => fillFrom(f));
  } else {
    it("pick", "Select", () => selectPart(l));
    if (act) it("fill", `Fill area into ${act.name}`, () => fillFrom(f));
    it("plus", "New part here", () => { placing = { part: -1, from: 0 }; placeAt(h); });
    it("solo", isSolo(l) ? "Show all again" : "Show only this", () => toggleSolo(l));
    it("eyeOff", "Hide", () => { p.visible = false; afterEdit(); });
    if (act) leaderOf(l) === S.active ? it("unlink", `Stop moving with ${act.name}`, () => setFollow([l], null))
      : it("link", `Move with ${act.name}`, () => setFollow([l], S.active));
    if (act) reachOf(l) === S.active ? it("unlink", `Stop reaching for ${act.name}`, () => setReach(l, 0))
      : it("reach", `Reach for ${act.name} (turn at its joint, stretch)`, () => setReach(l, S.active));
    it("replace", p.rep ? "Replace with another…" : "Replace with…", () => replaceWith(l));
    if (p.rep) it("reset", "Remove replacement", () => { selectPart(l); $("repDel").click(); });
    if (holesIn(l)) it("fill", "Close holes in this part", () => closeHoles(l));
    it("trash", "Delete (merge into neighbor)", () => deletePart(l), "danger");
    it("trash", "Delete geometry, close holes", () => deleteGeometry([l], true), "danger");
    it("trash", "Delete geometry, leave holes", () => deleteGeometry([l], false), "danger");
  }
  if (anyUn && l !== 0) it("fill", "Fill all unassigned", () => fillUnassigned(-1));
  else if (l === 0) it("fill", "Fill all unassigned", () => fillUnassigned(-1));
  { const sel2 = selected(); if (l > 0 && sel2.length === 2 && !sel2.includes(l)) it("reach", `Hold between ${S.parts[sel2[0]].name} and ${S.parts[sel2[1]].name}`, () => setHold(l, sel2[0], sel2[1])); }
  if (l > 0 && holdersOf(l)) it("unlink", "Release (no longer held)", () => setHold(l, 0));
  if (l > 0 && mergeSel.size && selected().includes(l)) it("merge", `Merge ${selected().length} selected into ${S.parts[S.active].name}`, mergeSelected);
  showMenu(ev, `<span class="sw" style="background:${p.color}"></span>${esc(p.name)}`, items);
}
function showMenu(ev, head, items) {
  const m = $("ctxMenu"); m.innerHTML = `<div class="hd">${head}</div>`;
  for (const x of items) {
    if (x === "-") { m.insertAdjacentHTML("beforeend", '<div style="border-top:1px solid var(--line);margin:2px 0"></div>'); continue; }
    const b = document.createElement("button"); if (x.cls) b.className = x.cls;
    b.innerHTML = icon(x.ic) + esc(x.label);
    b.onclick = (e) => { e.stopPropagation(); closeCtx(); later(x.fn); };
    m.appendChild(b);
  }
  m.hidden = false;
  m.style.left = `${Math.max(4, Math.min(ev.clientX, innerWidth - m.offsetWidth - 8))}px`;
  m.style.top = `${Math.max(4, Math.min(ev.clientY, innerHeight - m.offsetHeight - 8))}px`;
}
// Right-click on a row in the parts list.
function openPartMenu(ev, i) {
  const p = S.parts[i], sel = selected(), multi = sel.length > 1 && sel.includes(i), items = [];
  const it = (ic, label, fn, cls = "") => items.push({ ic, label, fn, cls });
  if (i === 0) {
    it("fill", "Fill all unassigned", () => fillUnassigned(-1));
    it("eyeOff", p.visible ? "Hide" : "Show", () => { p.visible = !p.visible; afterEdit(); });
    showMenu(ev, `<span class="sw" style="background:${p.color}"></span>${esc(p.name)}`, items); return;
  }
  if (multi) {
    const main = S.parts[S.active];
    it("merge", `Merge ${sel.length} parts into ${main.name}`, mergeSelected);
    it("droplet", `Same filament as ${main.name} (F${main.filament})`, () => { pushUndo(); sel.forEach((j) => (S.parts[j].filament = main.filament)); afterEdit(`F${main.filament} on ${sel.length} parts`); });
    it("link", `Move with ${main.name}`, () => setFollow(sel.filter((j) => j !== S.active), S.active));
    it("solo", "Show only these", () => { S.parts.forEach((q, j) => (q.visible = sel.includes(j))); afterEdit(); });
    it("eyeOff", "Hide these", () => { sel.forEach((j) => (S.parts[j].visible = false)); afterEdit(); });
    items.push("-");
    it("trash", `Delete ${sel.length} parts (merge into neighbors)`, () => { const ps = sel.map((j) => S.parts[j]); mergeSel.clear(); for (const q of ps) { const j = S.parts.indexOf(q); if (j > 0) deletePart(j); } }, "danger");
    it("trash", `Delete geometry of ${sel.length} parts, close holes`, () => deleteGeometry(sel, true), "danger");
    it("trash", `Delete geometry of ${sel.length} parts, leave holes`, () => deleteGeometry(sel, false), "danger");
    showMenu(ev, `${sel.length} parts selected`, items); return;
  }
  it("text", "Rename", () => startRename(i));
  it("frame", "Zoom to part", () => { selectPart(i); frameBox(partWorldBox(i)); });
  it("solo", isSolo(i) ? "Show all again" : "Show only this", () => toggleSolo(i));
  it(p.visible ? "eyeOff" : "eye", p.visible ? "Hide" : "Show", () => { p.visible = !p.visible; afterEdit(); });
  if (p.seeds.length) it("eraser", "Clear points", () => { pushUndo(); p.seeds = []; afterEdit(); });
  items.push("-");
  if (i > 0) it("replace", p.rep ? "Replace with another…" : "Replace with…", () => replaceWith(i));
  if (holesIn(i)) it("fill", "Close holes in this part", () => closeHoles(i));
  it("trash", "Delete (merge into neighbor)", () => deletePart(i), "danger");
  it("trash", "Delete geometry, close holes", () => deleteGeometry([i], true), "danger");
  it("trash", "Delete geometry, leave holes", () => deleteGeometry([i], false), "danger");
  showMenu(ev, `<span class="sw" style="background:${p.color}"></span>${esc(p.name)} · F${p.filament}`, items);
}

// ---------------------------------------------------------------- guided add part
// + → click the model where the part is → it is grown from that point right away → a card next to the
// point offers Crease (re-grows live), another point, Done.
let placing = null, flow = null, ghost = null; // placing: {part: index|-1}; flow: {part, world}
function startPlacing(part = -1, from = 0) {
  if (!S.G) return;
  closeFlow(); closeAuto?.();
  placing = { part, from };
  $("view").classList.add("placing"); $("addPart").classList.add("on");
  $("placeHint").textContent = part < 0 ? "Click the new part" : `Click more of ${S.parts[part].name}`;
}
function stopPlacing() {
  placing = null;
  $("view").classList.remove("placing"); $("addPart").classList.remove("on");
  $("placeHint").hidden = true; if (ghost) ghost.visible = false; render();
}
function showGhost(h, ev) {
  if (!ghost) {
    ghost = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    ghost.renderOrder = 4; scene.add(ghost);
  }
  const r = view.getBoundingClientRect(), hint = $("placeHint");
  hint.hidden = false; hint.style.left = `${ev.clientX - r.left}px`; hint.style.top = `${ev.clientY - r.top}px`;
  if (!h) { ghost.visible = false; render(); return; }
  ghost.visible = true; ghost.scale.setScalar(S.G.diag * 0.009); ghost.position.copy(h.world);
  ghost.material.color.set(placing.part < 0 ? newPart().color : S.parts[placing.part].color);
  render();
}
function placeAt(h) {
  const snap = snapshot(), under = S.labels[h.face], from = placing.part < 0 ? under : placing.from;
  let i = placing.part;
  if (i < 0 || !S.parts[i]) { S.parts.push(newPart()); i = S.parts.length - 1; }
  S.parts[i].seeds.push(h.face); S.active = i;
  stopPlacing();
  busy(true);
  setTimeout(() => {
    try { segmentFromSeeds({ snap, only: [...new Set([i, under, from])] }); openFlow(i, h.world.clone(), from); }
    catch (e) { console.error(e); alert(e.message); } finally { busy(false); }
  }, 30);
}
function openFlow(i, world, from) {
  flow = { part: i, world, from };
  $("fpSw").style.background = S.parts[i].color; $("fpName").textContent = S.parts[i].name;
  $("fpCrease").value = $("lambda").value; $("fpCreaseOut").textContent = $("lambda").value + "°";
  $("flowPop").hidden = false; placeFlow();
}
function closeFlow() { flow = null; $("flowPop").hidden = true; }
function placeFlow() {
  if (!flow) return;
  const v = flow.world.clone().project(camera), r = view.getBoundingClientRect(), pop = $("flowPop");
  const x = (v.x + 1) / 2 * r.width, y = (1 - v.y) / 2 * r.height;
  pop.style.left = `${Math.min(r.width - pop.offsetWidth - 8, x + 36)}px`;
  pop.style.top = `${Math.max(8, Math.min(r.height - pop.offsetHeight - 8, y - 22))}px`;
}
controls.addEventListener("change", placeFlow);
canvas.addEventListener("pointerleave", () => { if (placing) { $("placeHint").hidden = true; if (ghost) ghost.visible = false; render(); } });
$("addPart").onclick = () => (placing ? stopPlacing() : startPlacing());
$("fpDone").onclick = closeFlow;
$("fpSeed").onclick = () => { if (flow) startPlacing(flow.part, flow.from); };
$("fpCrease").oninput = () => { $("fpCreaseOut").textContent = $("fpCrease").value + "°"; };
$("fpCrease").onchange = () => {
  $("lambda").value = $("fpCrease").value; syncSliders();
  const keep = flow; later(() => { segmentFromSeeds(keep ? { only: [keep.part, keep.from] } : {}); if (keep) openFlow(keep.part, keep.world, keep.from); });
};
// Ctrl/Shift+click: the first part selected stays the main one (merge target), others are added to mergeSel.
function toggleSel(i) {
  if (i <= 0) return;
  if (S.active <= 0) { selectPart(i); return; }
  if (i === S.active) { if (!mergeSel.size) return; const [n] = mergeSel; mergeSel.delete(n); S.active = n; refreshUI(); return; }
  mergeSel.has(i) ? mergeSel.delete(i) : mergeSel.add(i); refreshUI();
}
const selected = () => (S.active > 0 ? [S.active, ...mergeSel] : []);
$("mergeBtn").onclick = () => mergeSelected();
function mergeSelected() {
  const idx = [...mergeSel].filter((i) => i !== S.active && i > 0 && i < S.parts.length);
  mergeSel.clear();
  if (!idx.length || S.active <= 0) return;
  pushUndo();
  const set = new Set(idx);
  for (let f = 0; f < S.nF; f++) if (set.has(S.labels[f])) S.labels[f] = S.active;
  idx.forEach((i) => { S.parts[S.active].seeds.push(...S.parts[i].seeds); S.parts[i].seeds = []; });
  const into = S.parts[S.active];
  dropEmptyParts(); S.active = S.parts.indexOf(into); afterEdit(`Merged ${idx.length} part(s) into ${into.name}`);
}
$("clrSeeds").onclick = () => { pushUndo(); S.parts[S.active].seeds = []; afterEdit(); };
$("clrAllSeeds").onclick = () => { pushUndo(); S.parts.forEach((p) => (p.seeds = [])); afterEdit(); };
$("showAll").onclick = () => { S.parts.forEach((p) => (p.visible = true)); afterEdit(); };
let soloPrev = null; // visibility before "Show only this", restored when toggled off
function isSolo(i) { return S.parts.length > 1 && S.parts.every((q, j) => q.visible === (j === i)); }
function toggleSolo(i) {
  if (isSolo(i)) {
    const prev = soloPrev && soloPrev.length === S.parts.length && soloPrev.some((v, j) => v && j !== i) ? soloPrev : null;
    S.parts.forEach((q, j) => (q.visible = prev ? prev[j] : true));
    soloPrev = null;
  } else {
    soloPrev = S.parts.map((q) => q.visible);
    S.parts.forEach((q, j) => (q.visible = j === i));
  }
  afterEdit();
}
$("soloBtn").onclick = () => toggleSolo(S.active);
$("undoBtn").onclick = undo;
$("redoBtn").onclick = redo;
$("frameBtn").onclick = () => S.G && frame();
$("smoothBtn").onclick = () => S.G && later(() => smoothBoundaries());
$("segBtn").onclick = () => S.G && later(segmentFromSeeds);
$("shellBtn").onclick = () => S.G && later(splitShells);
$("openBtn").onclick = $("dropOpen").onclick = () => { closeMenus(); $("fileIn").click(); };
// selected-part card
const act = () => (S.G && S.active > 0 ? S.parts[S.active] : null);
$("pcColor").oninput = () => { const p = act(); if (p) { p.color = $("pcColor").value; updateColors(); drawSeeds(); syncReps(); } };
$("pcColor").onchange = () => refreshUI() || autosave();
// Commit as you type (some hosts never fire "change"), Enter/Esc leave the field.
let nameSnap = null; // undo snapshot taken on focus, pushed on the first real change
$("pcName").oninput = () => { const p = act(); const v = $("pcName").value.trim(); if (p && v && v !== p.name) { if (nameSnap) { pushUndo(nameSnap); nameSnap = null; } p.name = v; refreshUI(); autosave(); } };
$("pcName").onfocus = () => { nameSnap = act() ? snapshot() : null; };
$("pcName").onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter" || e.key === "Escape") $("pcName").blur(); };
$("pcName").onblur = () => { const p = act(); if (p) $("pcName").value = p.name; };
$("pcFil").onchange = () => { const p = act(); if (p) { p.filament = Math.max(1, Math.min(32, Math.round(+$("pcFil").value || 1))); refreshUI(); autosave(); } };
$("pcClose").onclick = () => selectPart(0);
$("pcDel").onclick = () => S.active > 0 && deletePart(S.active);
$("pcDelGeo").onclick = () => S.active > 0 && later(() => deleteGeometry([S.active], true));
// Tool panels dock at the right of the view. While one is open, the view's center moves to the middle of the
// space left of it, so the model isn't hidden behind the panel and keeps its size.
function fitViewToPanels() {
  const w = view.clientWidth, h = view.clientHeight;
  const open = [...document.querySelectorAll("#view > .gp")].find((g) => !g.hidden);
  const shift = open && w > 2 * open.offsetWidth ? Math.round((open.offsetWidth + 12) / 2) : 0;
  if (shift === (camera.view?.enabled ? camera.view.offsetX : 0)) return;
  if (shift) camera.setViewOffset(w, h, shift, 0, w, h); else camera.clearViewOffset();
  render();
}
// Split panel: one place for every way to split. Seeds and Paint are the seed / brush / fill tools.
let splitMethod = "auto";
function showSplit(on, m = splitMethod) {
  const P = $("splitPanel");
  splitMethod = m;
  P.hidden = !on; $("autoBtn").classList.toggle("on", on);
  document.querySelectorAll("#splitMethods [data-method]").forEach((b) => b.classList.toggle("on", b.dataset.method === m));
  P.querySelectorAll("[data-m]").forEach((d) => d.classList.toggle("show", d.dataset.m.split(" ").includes(m)));
  syncGizmo();
  if (on) renderPaintSw();
  fitViewToPanels();
}
function setSplitMethod(m) {
  showSplit(true, m);
  if (m === "seeds") setTool("seed");
  else if (m === "paint") setTool(S.tool === "fill" ? "fill" : "brush");
  else if (S.tool !== "orbit") setTool("orbit");
}
document.querySelectorAll("#splitMethods [data-method]").forEach((b) => (b.onclick = () => setSplitMethod(b.dataset.method)));
const closeAuto = () => { showSplit(false); if (S.tool !== "orbit") setTool("orbit"); };
$("autoBtn").onclick = () => { if ($("splitPanel").hidden) { setSplitMethod(splitMethod); if (splitMethod === "auto") $("autoK").focus(); } else closeAuto(); };
$("splitDone").onclick = closeAuto;
$("autoRun").onclick = () => { $("autoK").blur(); S.G && later(() => autoSplit($("autoK").value === "" ? 0 : Math.max(2, Math.min(32, +$("autoK").value | 0)))); };
$("autoK").addEventListener("keydown", (e) => { if (e.key === "Enter") $("autoRun").click(); if (e.key === "Escape") closeAuto(); });
// Paint into part: one swatch per part, numbered like OrcaSlicer's filament swatches.
function renderPaintSw() {
  const box = $("paintSw"); if ($("splitPanel").hidden || splitMethod !== "paint" || !S.G) return;
  box.innerHTML = "";
  S.parts.forEach((p, i) => {
    if (!i) return;
    const b = document.createElement("button");
    b.textContent = i; b.title = p.name; b.style.background = p.color; b.classList.toggle("on", i === S.active);
    b.onclick = () => selectPart(i);
    box.appendChild(b);
  });
  const add = document.createElement("button");
  add.textContent = "+"; add.title = "New part to paint into"; add.style.background = "var(--in)";
  add.onclick = () => { pushUndo(); S.parts.push(newPart()); S.active = S.parts.length - 1; afterEdit(`${S.parts[S.active].name} added: paint it on the model`); };
  box.appendChild(add);
}
// review card
// The card sits under the tool panels (Split, Transform) at the top right, so opening it closes them as Done does.
const showAi = (on, connect = true) => { // connect: open the Connect step when no AI model is set up
  if (on) { if (!$("splitPanel").hidden) closeAuto(); if (gzOn) setGizmo("off"); }
  $("aiCard").hidden = !on; $("aiToggle").classList.toggle("on", on);
  if (on && connect && LLM.st && !LLM.st.configured && !LLM.job) llmSettings(true);
};
$("aiToggle").onclick = () => showAi($("aiCard").hidden);
$("aiClose").onclick = () => showAi(false);
$("fileIn").onchange = async () => { const f = $("fileIn").files[0]; if (f) openFile(f); };
async function openBuf(name, buf, remember = true) {
  busy(true);
  try { await loadArrayBuffer(name, buf); if (remember) recentPut(name, buf); } catch (e) { console.error(e); alert(e.message); }
  busy(false);
}
async function openFile(f) { await openBuf(f.name, await f.arrayBuffer()); }
// recent files: bytes kept in IndexedDB (browser files have no path to reopen)
const RECENT_MAX = 8;
function rdb() { return new Promise((res, rej) => { const r = indexedDB.open("meshsplit", 1); r.onupgradeneeded = () => r.result.createObjectStore("recent", { keyPath: "name" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
const rreq = (q) => new Promise((res, rej) => { q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
async function recentAll() { try { const db = await rdb(); return (await rreq(db.transaction("recent").objectStore("recent").getAll())).sort((a, b) => b.t - a.t); } catch { return []; } }
async function recentPut(name, buf) {
  if (buf.byteLength > 200e6) return;
  try {
    const db = await rdb(), st = db.transaction("recent", "readwrite").objectStore("recent");
    await rreq(st.put({ name, buf: buf.slice(0), size: buf.byteLength, t: Date.now() }));
    const all = (await rreq(st.getAll())).sort((a, b) => b.t - a.t);
    for (const r of all.slice(RECENT_MAX)) st.delete(r.name);
  } catch (e) { console.warn("recent files:", e.message); }
  renderRecent();
}
const ago = (t) => { const m = (Date.now() - t) / 6e4; return m < 60 ? `${Math.max(1, m | 0)} min` : m < 1440 ? `${(m / 60) | 0} h` : `${(m / 1440) | 0} d`; };
async function renderRecent() {
  const all = await recentAll();
  for (const box of [$("recentMenu"), $("dropRecent")]) {
    box.innerHTML = "";
    for (const r of all) {
      const b = document.createElement("button"); b.title = r.name;
      b.innerHTML = `${icon("open")}<span style="overflow:hidden;text-overflow:ellipsis;max-width:320px">${esc(r.name)}</span><span class="meta">${ago(r.t)}</span>`;
      b.onclick = () => { closeMenus(); openBuf(r.name, r.buf); };
      box.appendChild(b);
    }
  }
  $("recentHd").hidden = !all.length;
}
function closeMenus() { document.querySelectorAll(".menu").forEach((m) => (m.hidden = true)); }
function toggleMenu(id) { const m = $(id), was = m.hidden; closeMenus(); m.hidden = !was; }
$("fileBtn").onclick = (e) => { e.stopPropagation(); if (ORCA.on) orcaSend({ cmd: "objects" }); toggleMenu("fileMenu"); };
$("expBtn").onclick = (e) => { e.stopPropagation(); toggleMenu("expMenu"); };
document.addEventListener("click", (e) => { if (!e.target.closest(".menu")) closeMenus(); });
// filament color view
const setColorMode = (on) => { byFilament = on; $("colorMode").classList.toggle("on", on); try { localStorage.setItem("meshsplit:byFil", on ? "1" : "0"); } catch {} updateColors(); };
$("colorMode").onclick = () => setColorMode(!byFilament);
view.addEventListener("dragover", (e) => e.preventDefault());
view.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) openFile(f); });
window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" && e.target.type !== "range") return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (k === "z" || k === "y") { e.preventDefault(); (k === "y" || e.shiftKey ? redo : undo)(); }
    else if (k === "o" && !document.body.classList.contains("inOrca")) { e.preventDefault(); $("fileIn").click(); }
    else if (k === "e" && S.G && !document.body.classList.contains("inOrca")) { e.preventDefault(); $("expMain").click(); }
    return;
  }
  if (e.key === "Home" && S.G) { e.preventDefault(); frame(); return; }
  if (e.key === "Escape") { if (!$("ctxMenu").hidden) closeCtx(); else if (placing) stopPlacing(); else if (flow) closeFlow(); else if (pickingJoint) { pickingJoint = false; refreshUI(); status(""); } else if (S.G && S.active) selectPart(0); else if (!$("splitPanel").hidden) closeAuto(); return; }
  if (e.key === "Delete" && S.G && S.active > 0) { if (e.shiftKey) later(() => deleteGeometry(selected(), true)); else deletePart(S.active); return; }
  if (k === "c" && S.G) { setColorMode(!byFilament); return; }
  if (S.G && S.active > 0 && k === "j") { setGizmoJoint(!gzJointOn); return; }
  if (S.G && S.active > 0 && (k === "w" || k === "e" || k === "r")) { setGizmo({ w: "translate", e: "rotate", r: "scale" }[k]); return; }
  if (S.G && k === "q") { setGizmo("off"); return; }
  const t = TOOLS.find((t) => t.key === k);
  if (k === "a" && S.G) { $("autoBtn").click(); return; }
  if (t) setTool(t.id);
});

// ---------------------------------------------------------------- replace part
// part.rep = { id, name, fit, embed, flip, roll, joint:{p,n}|null }; mesh data lives in REPS (not in undo snapshots).
// Alignment: the old part's joint (its longest cut loop: centroid J, normal n pointing out of the part into the rest)
// is matched by the replacement's joint (an end of its long axis, or a clicked point), long axes are lined up,
// optionally scaled to the old part's length, and pushed `embed` mm into the rest so the slicer unions them.
const REPS = new Map();
const repMeshes = new Map(); // rep id -> THREE.Mesh
let repSeq = 1;
const pjCache = new Map();

function eig3(C) { // Jacobi; returns eigenvectors (columns) sorted by eigenvalue desc
  const a = C.map((r) => r.slice()), V = [[1,0,0],[0,1,0],[0,0,1]];
  for (let sweep = 0; sweep < 30; sweep++) for (const [p, q] of [[0,1],[0,2],[1,2]]) {
    if (Math.abs(a[p][q]) < 1e-12) continue;
    const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th*th + 1));
    const c = 1 / Math.sqrt(t*t + 1), s = t * c;
    for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c*akp - s*akq; a[k][q] = s*akp + c*akq; }
    for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c*apk - s*aqk; a[q][k] = s*apk + c*aqk; }
    for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c*vkp - s*vkq; V[k][q] = s*vkp + c*vkq; }
  }
  return [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]).map((i) => new THREE.Vector3(V[0][i], V[1][i], V[2][i]).normalize());
}
// Area-weighted PCA of a triangle soup (flat xyz x9 per triangle).
function soupPCA(v) {
  let A = 0; const m = new THREE.Vector3();
  const tris = [];
  for (let o = 0; o < v.length; o += 9) {
    const ux = v[o+3]-v[o], uy = v[o+4]-v[o+1], uz = v[o+5]-v[o+2], wx = v[o+6]-v[o], wy = v[o+7]-v[o+1], wz = v[o+8]-v[o+2];
    const a = Math.hypot(uy*wz - uz*wy, uz*wx - ux*wz, ux*wy - uy*wx) / 2 + 1e-12;
    const c = [(v[o]+v[o+3]+v[o+6])/3, (v[o+1]+v[o+4]+v[o+7])/3, (v[o+2]+v[o+5]+v[o+8])/3];
    tris.push([a, c]); A += a; m.x += a*c[0]; m.y += a*c[1]; m.z += a*c[2];
  }
  m.divideScalar(A);
  const C = [[0,0,0],[0,0,0],[0,0,0]];
  for (const [a, c] of tris) { const d = [c[0]-m.x, c[1]-m.y, c[2]-m.z]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += a*d[i]*d[j]; }
  return { mean: m, axes: eig3(C) };
}

// body: pick the cut toward the rest of the model (rotate on joint), not just the longest: cuts to parts that hang
// off this one (what it carries, holds or reaches for) are skipped, and of the rest the cut to the biggest neighbor that
// is bigger than this part wins (an arm's shoulder, not its wrist); with none bigger, the longest. Without body
// (Replace), the longest cut.
function partJoint(pi, body = false) {
  const pm = meshOf((l) => l === pi);
  if (!pm) return null;
  const P = (v) => new THREE.Vector3(S.pos[3*v], S.pos[3*v+1], S.pos[3*v+2]);
  let best = null, bestLen = -1, loops = pm.loopList;
  if (body && loops.length > 1) {
    const tw = twinLabels(fullHash()), nV = S.nV, cnt = partCounts(), u = S.parts[pi].uid;
    const skip = new Set([pi, 0, ...followersOf(pi)]);
    if (u) S.parts.forEach((q, j) => { if (j > 0 && (q.hold?.a === u || q.hold?.b === u)) skip.add(j); });
    if (reachOf(pi) > 0) skip.add(reachOf(pi));
    const nbOf = (lp) => { const m = new Map(); for (const [a, b] of lp) { const n = tw.get(b * nV + a); if (n !== undefined) m.set(n, (m.get(n) || 0) + 1); } return [...m].sort((x, y) => y[1] - x[1])[0]?.[0] ?? -1; };
    const ok = loops.map((lp) => [lp, nbOf(lp)]).filter(([, n]) => n >= 0 && !skip.has(n));
    const big = ok.filter(([, n]) => (cnt[n] || 0) > (cnt[pi] || 0)); // toward the body: a neighbor bigger than this part
    if (big.length) { const top = Math.max(...big.map(([, n]) => cnt[n])); loops = big.filter(([, n]) => cnt[n] === top).map(([lp]) => lp); }
    else if (ok.length) loops = ok.map(([lp]) => lp);
  }
  for (const loop of loops) {
    let len = 0; for (const [a, b] of loop) len += P(a).distanceTo(P(b));
    if (len > bestLen) { bestLen = len; best = loop; }
  }
  const pca = soupPCA(pm.verts.slice(0, pm.nFaceVerts));
  if (!best) { // no cut (whole shell): attach at the bottom
    const b = partBox(pi);
    return { J: new THREE.Vector3((b[0]+b[3])/2, (b[1]+b[4])/2, b[2]), n: new THREE.Vector3(0, 0, -1), pca, verts: pm.verts, nv: pm.nFaceVerts };
  }
  const J = new THREE.Vector3(); for (const [a] of best) J.add(P(a)); J.divideScalar(best.length);
  const n = new THREE.Vector3(); // sum of cap triangle normals (b, a, J): outward of the part through the cut
  for (const [a, b] of best) { const pb = P(b); n.add(new THREE.Vector3().subVectors(P(a), pb).cross(new THREE.Vector3().subVectors(J, pb))); }
  if (n.lengthSq() < 1e-12) n.subVectors(J, pca.mean);
  return { J, n: n.normalize(), pca, verts: pm.verts, nv: pm.nFaceVerts, loopLen: bestLen, loopKey: core.loopKey(best) };
}

function repJoint(R, rep) {
  if (rep.joint) return { p: new THREE.Vector3(...rep.joint.p), n: new THREE.Vector3(...rep.joint.n).normalize() };
  const ax = R.pca.axes[0], v = R.pos;
  let lo = Infinity, hi = -Infinity;
  for (let o = 0; o < v.length; o += 3) { const t = ax.x*v[o] + ax.y*v[o+1] + ax.z*v[o+2]; lo = Math.min(lo, t); hi = Math.max(hi, t); }
  const band = (hi - lo) * 0.05, ends = [lo, hi].map((e) => {
    const c = new THREE.Vector3(); let n = 0, r = 0;
    for (let o = 0; o < v.length; o += 3) { const t = ax.x*v[o] + ax.y*v[o+1] + ax.z*v[o+2]; if (Math.abs(t - e) <= band) { c.x += v[o]; c.y += v[o+1]; c.z += v[o+2]; n++; } }
    c.divideScalar(n || 1);
    for (let o = 0; o < v.length; o += 3) { const t = ax.x*v[o] + ax.y*v[o+1] + ax.z*v[o+2]; if (Math.abs(t - e) <= band) r += Math.hypot(v[o]-c.x, v[o+1]-c.y, v[o+2]-c.z); }
    c.addScaledVector(ax, e - c.dot(ax)); // onto the end plane
    return { c, r: r / (n || 1) };
  });
  let k = ends[0].r <= ends[1].r ? 0 : 1; // default: the thinner end attaches
  if (rep.flip) k = 1 - k;
  return { p: ends[k].c, n: ax.clone().multiplyScalar(k === 0 ? -1 : 1) };
}

// Matrix from replacement-file space to world (before the part's own Transform panel offset).
function repAlign(pi) {
  const p = S.parts[pi], rep = p.rep, R = REPS.get(rep.id); if (!R) return null;
  if (rep.inPlace) return new THREE.Matrix4(); // already in this model's coordinates
  const ck = `${rep.id}|${pi}|${fullHash()}`;
  if (!pjCache.has(ck)) { pjCache.clear(); pjCache.set(ck, partJoint(pi)); }
  const pj = pjCache.get(ck); if (!pj) return null;
  const rj = repJoint(R, rep);
  const q1 = new THREE.Quaternion().setFromUnitVectors(rj.n, pj.n);
  // roll: line up the second principal axes in the joint plane
  const proj = (u) => u.clone().addScaledVector(pj.n, -u.dot(pj.n));
  const a = proj(R.pca.axes[1].clone().applyQuaternion(q1)), b = proj(pj.pca.axes[1]);
  let ang = 0;
  if (a.lengthSq() > 1e-8 && b.lengthSq() > 1e-8) {
    a.normalize(); b.normalize();
    ang = Math.atan2(new THREE.Vector3().crossVectors(a, b).dot(pj.n), a.dot(b));
    if (Math.abs(ang) > Math.PI / 2) ang -= Math.sign(ang) * Math.PI; // axes have no sign
  }
  const q = new THREE.Quaternion().setFromAxisAngle(pj.n, ang + (rep.roll || 0) * Math.PI / 180).multiply(q1);
  let s = 1;
  if (rep.fit) {
    const span = (v, n, ax) => { let lo = Infinity, hi = -Infinity; for (let o = 0; o < n; o += 3) { const t = ax.x*v[o] + ax.y*v[o+1] + ax.z*v[o+2]; lo = Math.min(lo, t); hi = Math.max(hi, t); } return hi - lo; };
    const Lp = span(pj.verts, pj.nv, pj.pca.axes[0]), Lr = span(R.pos, R.pos.length, R.pca.axes[0]); // longest dimension to longest dimension
    if (Lp > 0 && Lr > 0) s = Lp / Lr;
  }
  const at = pj.J.clone().addScaledVector(pj.n, +rep.embed || 0);
  return new THREE.Matrix4().compose(at, q, new THREE.Vector3(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-rj.p.x, -rj.p.y, -rj.p.z));
}
function repMatrix(pi) {
  const A = repAlign(pi); if (!A) return null;
  const X = xfMatrix(S.parts[pi]);
  return X ? X.multiply(A) : A;
}

function syncReps() {
  const live = new Set();
  S.parts.forEach((p, i) => {
    if (!p.rep || !REPS.has(p.rep.id)) return;
    live.add(p.rep.id);
    let m = repMeshes.get(p.rep.id);
    if (!m) {
      const R = REPS.get(p.rep.id), g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(R.pos, 3)); g.computeVertexNormals();
      m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, side: THREE.DoubleSide }));
      m.matrixAutoUpdate = false; repMeshes.set(p.rep.id, m); scene.add(m);
    }
    m.userData.part = i;
    m.material.color.copy(shownColor(i)); m.visible = p.visible;
    const M = repMatrix(i); if (M) { m.matrix.copy(M); m.matrixWorldNeedsUpdate = true; }
  });
  for (const [id, m] of repMeshes) if (!live.has(id)) { scene.remove(m); m.geometry.dispose(); repMeshes.delete(id); }
  render();
}

function readMeshFile(name, buf) {
  const ext = name.toLowerCase().split(".").pop();
  let pos, tri;
  if (ext === "stl") { pos = core.parseSTL(buf); tri = null; }
  else if (ext === "3mf") { const r = parse3MF(buf); pos = r.pos; tri = r.tri; }
  else throw new Error("Unsupported file type: " + ext);
  if (!tri) return new Float32Array(pos);
  const out = new Float32Array(tri.length * 3);
  for (let i = 0; i < tri.length; i++) for (let k = 0; k < 3; k++) out[3*i+k] = pos[3*tri[i]+k];
  return out;
}
function addRep(name, pos, id = `r${Date.now().toString(36)}${repSeq++}`) {
  REPS.set(id, { name, pos, pca: soupPCA(pos) });
  return id;
}
async function replaceActive(file) {
  const i = S.active; if (!S.G || i <= 0) return;
  const pos = readMeshFile(file.name, await file.arrayBuffer());
  if (pos.length < 9) throw new Error("No triangles in " + file.name);
  const id = addRep(file.name.replace(/\.[^.]+$/, ""), pos);
  pushUndo();
  const p = S.parts[i];
  const inPlace = overlapsPart(pos, i);
  p.rep = { id, name: REPS.get(id).name, fit: !inPlace, embed: inPlace ? 0 : 1, flip: false, roll: 0, joint: null, inPlace };
  const pj = inPlace ? null : partJoint(i);
  p.xf = { s: [1, 1, 1], r: [0, 0, 0], t: [0, 0, 0], c: pj ? pj.J.toArray() : ensureXf(i).c }; // transform pivots on the joint
  afterEdit(`${p.name} replaced by ${p.rep.name}${inPlace ? " (kept in place)" : pj?.loopLen ? "" : " (part has no cut, attached at its bottom)"}`);
}
// A replacement whose box matches the old part's (center within 10% of its size, same size within 25%) was made
// from this same model, e.g. the part edited elsewhere: keep its coordinates instead of snapping it onto the joint.
function overlapsPart(pos, i) {
  const a = partBox(i), b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let o = 0; o < pos.length; o += 3) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], pos[o+k]); b[k+3] = Math.max(b[k+3], pos[o+k]); }
  const da = Math.hypot(a[3]-a[0], a[4]-a[1], a[5]-a[2]), db = Math.hypot(b[3]-b[0], b[4]-b[1], b[5]-b[2]);
  const dc = Math.hypot((a[0]+a[3]-b[0]-b[3])/2, (a[1]+a[4]-b[1]-b[4])/2, (a[2]+a[5]-b[2]-b[5])/2);
  return da > 0 && dc < 0.1 * da && db / da > 0.8 && db / da < 1.25;
}
// Right-click "Replace with…": select the part, then pick the mesh. The replacement keeps the part's name and filament
// slot, sits on the part's joint (its cut), is scaled to the old part's length (fit) and can be dragged with the gizmo.
function replaceWith(i) { if (i <= 0) return; selectPart(i); $("repIn").click(); }
function repEdit(fn, msg) { const p = S.parts[S.active]; if (!p?.rep) return; pushUndo(); fn(p.rep); afterEdit(msg); }

// ---------------------------------------------------------------- transform panel
let xfSnap = null;
const xfIn = (g, k) => $(`xf${g}${k}`);
function partWorldBox(i) {
  const rm = S.parts[i]?.rep && repMeshes.get(S.parts[i].rep.id);
  if (rm) { rm.updateMatrixWorld(); const bb = new THREE.Box3().setFromObject(rm); return [...bb.min.toArray(), ...bb.max.toArray()]; }
  const P = mesh.geometry.getAttribute("position").array, b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let f = 0; f < S.nF; f++) if (S.labels[f] === i) for (let o = 9 * f; o < 9 * f + 9; o += 3)
    for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], P[o+k]); b[k+3] = Math.max(b[k+3], P[o+k]); }
  return b;
}
function refreshXfPanel() {
  const i = S.active, p = S.parts[i], ok = !!S.G && i > 0 && !!p;
  $("partCard").hidden = !ok;
  if (ok) {
    $("pcColor").value = p.color; $("pcFil").value = p.filament;
    if (document.activeElement !== $("pcName")) $("pcName").value = p.name;
    $("clrSeeds").disabled = !p.seeds.length;
  }
  $("clrAllSeeds").disabled = !S.G || !S.parts.some((q) => q.seeds.length);
  $("xfReset").disabled = !ok || (isIdXf(p?.xf) && !p?.xf?.st?.auto);
  $("gzCenter").classList.toggle("on", !gzJointOn);
  $("healRow").classList.toggle("hide", !ok || !!p?.rep);
  $("anchorRow").classList.toggle("hide", !ok || !!p?.rep);
  $("gapAnchor").classList.toggle("on", ok && !!p?.anchor); $("gapFill").classList.toggle("on", ok && !!p?.fill && !p?.anchor);
  $("gapOpen").classList.toggle("on", ok && !p?.fill && !p?.anchor);
  $("stretchRow").classList.toggle("hide", !ok || !!p?.rep);
  $("trimRow").classList.toggle("hide", !ok || !!p?.rep); $("trimOn").checked = ok && !!p?.trim;
  for (const [id, m] of [["mvFree", "free"], ["mvPlate", "plate"], ["mvJoint", "joint"]]) $(id).classList.toggle("on", gzSlide === m);
  const au = ok && !!p.xf?.st?.auto;
  if (ok && document.activeElement !== $("stretchPct")) $("stretchPct").value = +((p.xf?.st?.k ?? 1) * 100).toFixed(au ? 0 : 1);
  $("stretchAuto").checked = au; $("stretchPct").disabled = au; $("stretchGapRow").classList.toggle("hide", !au);
  if (au && document.activeElement !== $("stretchGap")) $("stretchGap").value = p.xf.st.gap ?? 1;
  if (ok && !p.rep) { $("healOn").checked = !!p.heal; if (document.activeElement !== $("healR")) $("healR").value = p.heal?.r ?? ""; $("healR").placeholder = "auto"; $("healR").disabled = !p.heal; }
  const x = (ok && p.xf) || { s: [1, 1, 1], r: [0, 0, 0], t: [0, 0, 0] };
  for (let k = 0; k < 3; k++) {
    xfIn("S", k).value = +(x.s[k] * 100).toFixed(2); xfIn("R", k).value = +x.r[k].toFixed(2); xfIn("T", k).value = +x.t[k].toFixed(3);
  }
  const r = ok && p.rep;
  $("repOpts").classList.toggle("hide", !r);
  $("repBtn").title = r ? "Swap for a different STL/3MF" : "Swap this part for another STL/3MF, lined up on the old part's joint";
  $("repDel").style.display = r ? "" : "none";
  $("repName").textContent = r ? `→ ${r.name}${REPS.has(r.id) ? "" : " (missing mesh)"}` : "";
  $("repName").title = r ? r.name : "";
  if (r) { $("repKeep").checked = !!r.inPlace; for (const id of ["repFlip", "repRoll", "repPick", "repFitL", "repEmbedL"]) $(id).style.display = r.inPlace ? "none" : "";
    $("repFit").checked = !!r.fit; $("repEmbed").value = r.embed; $("repFlip").classList.toggle("on", !!r.flip && !r.joint); $("repPick").classList.toggle("on", pickingJoint || !!r.joint); }
  renderFollowRow(i); renderHitRow(i);
  showXfDims();
  syncGizmo();
  renderPaintSw();
}
function showXfDims() {
  const i = S.active;
  const info = $("info");
  if (!S.G || !mesh || i <= 0) { info.hidden = true; return; }
  const b = partWorldBox(i), p = S.parts[i];
  const dims = isFinite(b[0]) ? `${(b[3]-b[0]).toFixed(1)} × ${(b[4]-b[1]).toFixed(1)} × ${(b[5]-b[2]).toFixed(1)} mm` : "no faces";
  info.innerHTML = `Part name: ${esc(p.name)}<br>Size: ${dims}<br>Triangles: ${partCounts()[i].toLocaleString()} · Filament ${p.filament}`;
  info.hidden = false;
}
$("xfPanel").addEventListener("focusin", () => { if (S.G) xfSnap = snapshot(); });
$("xfPanel").addEventListener("input", (ev) => {
  const i = S.active; if (!S.G || i <= 0) return;
  const x = ensureXf(i), id = ev.target.id, num = (el, d) => (Number.isFinite(+el.value) && el.value !== "" ? +el.value : d);
  if (id.startsWith("xfS") && $("xfLock").checked) for (let k = 0; k < 3; k++) if (xfIn("S", k) !== ev.target) xfIn("S", k).value = ev.target.value;
  for (let k = 0; k < 3; k++) {
    let s = num(xfIn("S", k), 100) / 100; if (Math.abs(s) < 0.01) s = s < 0 ? -0.01 : 0.01;
    x.s[k] = s; x.r[k] = num(xfIn("R", k), 0); x.t[k] = num(xfIn("T", k), 0);
  }
  xfEdited(i); applyXf(); syncReps(); drawSeeds(); showXfDims();
});
$("xfPanel").addEventListener("change", () => {
  if (!S.G || S.active <= 0) return;
  if (xfSnap) pushUndo(xfSnap);
  xfSnap = snapshot();
  refreshUI(); autosave();
});
$("healOn").onchange = () => {
  const i = S.active, p = S.parts[i]; if (!S.G || i <= 0 || !p) return;
  if ($("healOn").checked && !healBase(i)) { $("healOn").checked = false; status(`${p.name} has no cut to heal`); return; }
  pushUndo();
  if ($("healOn").checked) p.heal = { r: healDefault(i) }; else delete p.heal;
  afterEdit($("healOn").checked ? `Heal joint on ${p.name}: blends ${p.heal.r} mm from the cut` : `Heal joint off on ${p.name}`);
};
$("healR").onchange = () => {
  const i = S.active, p = S.parts[i]; if (!S.G || i <= 0 || !p?.heal) return;
  const r = +$("healR").value; if (!(r > 0)) { refreshUI(); return; }
  pushUndo(); p.heal = { r }; afterEdit(`Heal blend on ${p.name}: ${r} mm`);
};
$("gapOpen").onclick = () => { if (S.G && S.active > 0) setGap(selected(), "open"); };
$("gapFill").onclick = () => { if (S.G && S.active > 0) setGap(selected(), "fill"); };
$("gapAnchor").onclick = () => { if (S.G && S.active > 0) setGap(selected(), "anchor"); };
$("trimOn").onchange = () => { if (S.G && S.active > 0) setTrim(selected(), $("trimOn").checked); };
$("stretchAuto").onchange = () => { if (S.G && S.active > 0) setAutoStretch(selected(), $("stretchAuto").checked); };
$("stretchGap").onchange = () => {
  const g = +$("stretchGap").value; if (!S.G || S.active <= 0 || !(g >= 0)) { refreshUI(); return; }
  setAutoStretch(selected(), true, g);
};
$("stretchPct").onchange = () => {
  if (!S.G || S.active <= 0) return;
  const v = +$("stretchPct").value; if (!(v > 0)) { refreshUI(); return; }
  setStretch(selected(), v);
};
$("xfReset").onclick = () => {
  const p = S.parts[S.active]; if (!S.G || S.active <= 0 || !p.xf) return;
  pushUndo(); delete p.xf; xfEdited(S.active); afterEdit(`Transform reset on ${p.name}`);
};

// ---------------------------------------------------------------- transform gizmo
// Drag handles in the view, mapped 1:1 onto part.xf: a proxy at pivot+t with rotation r and scale s has the same
// matrix as xfMatrix(). W/E/R pick move/rotate/scale, Q hides it; Shift snaps. One undo step per drag.
const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setSize(0.85);
const gzProxy = new THREE.Object3D();
scene.add(gzProxy); scene.add(gizmo.getHelper()); // three r169+: TransformControls is no longer an Object3D
let gzMode = "translate", gzOn = true, gzSnap = null, gzSync = false;
try { const m = localStorage.getItem("meshsplit:gizmo"); if (m === "off") gzOn = false; else if (m) gzMode = m; } catch {}
gizmo.addEventListener("change", render);
function gizmoTarget() { const i = S.active; return S.G && mesh && i > 0 && S.parts[i] && S.parts[i].visible !== false && partCounts()[i] > 0 ? i : -1; }
function syncGizmo() {
  const i = gizmoTarget();
  document.querySelectorAll("#gzModes [data-gz]").forEach((b) => b.classList.toggle("on", gzOn && b.dataset.gz === gzMode));
  $("gzJoint").classList.toggle("on", gzJointOn);
  const card = $("xfCard"), show = gzOn && i >= 0 && S.tool === "orbit" && !placing && !pickingJoint && $("splitPanel").hidden;
  card.hidden = !show; card.dataset.mode = gzMode;
  fitViewToPanels();
  $("gzCenter").classList.toggle("on", !gzJointOn);
  if (!gzOn || i < 0 || S.tool !== "orbit" || placing || pickingJoint) { jointAxis.visible = false; if (gizmo.object) { gizmo.detach(); render(); } return; }
  if (gizmo.dragging) return;
  const x = S.parts[i].xf || { s: [1, 1, 1], r: [0, 0, 0], t: [0, 0, 0], c: (() => { const b = partBox(i); return [0, 1, 2].map((k) => (b[k] + b[k+3]) / 2); })() };
  gzSync = true;
  gzProxy.position.set(x.c[0] + x.t[0], x.c[1] + x.t[1], x.c[2] + x.t[2]);
  gzProxy.rotation.set(...x.r.map((d) => d * Math.PI / 180), "XYZ");
  gzProxy.scale.set(...x.s);
  gzProxy.updateMatrixWorld();
  gzSync = false;
  const jf = gzMode === "rotate" && gzJointOn ? jointFrame(i) : null;
  if (jf) { gzSync = true; gzProxy.position.copy(jf.J); gzProxy.quaternion.copy(jf.q); gzProxy.scale.set(1, 1, 1); gzProxy.updateMatrixWorld(); gzSync = false; }
  const sf = gzMode === "translate" && gzSlide === "joint" ? jointFrame(i) : null; // slide along the cut: local X/Z span its plane
  if (sf) { gzSync = true; gzProxy.quaternion.copy(sf.q); gzProxy.scale.set(1, 1, 1); gzProxy.updateMatrixWorld(); gzSync = false; }
  gizmo.setMode(gzMode);
  gizmo.setSpace(gzMode === "scale" || jf || sf ? "local" : "world");
  gizmo.showX = gizmo.showZ = !jf; // on a joint only the ring about the joint axis (local Y) is offered
  gizmo.showY = !sf; // sliding on the joint: no handle off the cut's plane
  if (gzMode === "translate" && gzSlide === "plate") gizmo.showZ = false; // on the plate: no up/down handle
  showJointAxis(jf || sf);
  if (gizmo.object !== gzProxy) gizmo.attach(gzProxy);
  render();
}
// Rotate on joint: the part's joint (longest cut loop: centroid J, plane normal n) moved by its current transform.
// The gizmo proxy sits at J with local Y along n; a drag becomes a rotation about that axis through J.
let gzJointOn = false, gzJoint = null;
try { gzJointOn = localStorage.getItem("meshsplit:gzJoint") === "1"; } catch {}
// Move along: "free" (X/Y/Z), "plate" (X/Y only: the part keeps its height, so a foot stays on the plate) or "joint"
// (the two axes in the plane of the part's cut: it slides along the part it joins).
let gzSlide = "free";
try { gzSlide = localStorage.getItem("meshsplit:gzSlide") || "free"; } catch {}
function setSlide(m) {
  gzSlide = m;
  try { localStorage.setItem("meshsplit:gzSlide", m); } catch {}
  if (m === "joint" && S.G && S.active > 0 && !jointFrame(S.active)) status(`${S.parts[S.active].name} has no cut, so it moves on the world axes`);
  refreshUI();
}
$("mvFree").onclick = () => setSlide("free");
$("mvPlate").onclick = () => setSlide("plate");
$("mvJoint").onclick = () => setSlide("joint");
const jointCache = new Map();
function bodyJoint(i) { // partJoint(i, true), cached
  const key = `${i}|${S.nF}|${fullHash()}|${S.parts.map((q) => (q.follow?.to ?? "") + "," + (q.hold ? q.hold.a + q.hold.b : "") + "," + (q.reach?.to ?? "")).join(";")}`;
  if (!jointCache.has(key)) { if (jointCache.size > 40) jointCache.clear(); jointCache.set(key, partJoint(i, true)); }
  return jointCache.get(key);
}
function jointFrame(i) {
  const pj = bodyJoint(i);
  if (!pj?.loopLen) return null; // no cut: plain world-axis rotation
  const M = xfMatrix(S.parts[i]) || new THREE.Matrix4();
  const J = pj.J.clone().applyMatrix4(M), n = pj.n.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(M)).normalize();
  return { J, n, q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n), len: pj.loopLen / Math.PI * 0.75 };
}
const jointAxis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0)]),
  new THREE.LineDashedMaterial({ color: 0xffa000, dashSize: 0.06, gapSize: 0.04, depthTest: false, transparent: true }));
jointAxis.computeLineDistances(); jointAxis.renderOrder = 5; jointAxis.visible = false; scene.add(jointAxis);
function showJointAxis(jf) {
  jointAxis.visible = !!jf;
  if (!jf) return;
  jointAxis.position.copy(jf.J); jointAxis.quaternion.copy(jf.q); jointAxis.scale.setScalar(jf.len);
}
function setGizmoJoint(on) {
  gzJointOn = on;
  try { localStorage.setItem("meshsplit:gzJoint", on ? "1" : "0"); } catch {}
  if (on && S.G && S.active > 0) {
    if (!gzOn || gzMode !== "rotate") { gzOn = true; gzMode = "rotate"; if (S.tool !== "orbit") setTool("orbit"); }
    if (!jointFrame(S.active)) status(`${S.parts[S.active].name} has no cut, so it rotates on the world axes`);
  }
  syncGizmo();
}
$("gzJoint").onclick = () => setGizmoJoint(true);
$("gzCenter").onclick = () => setGizmoJoint(false);
$("xfDone").onclick = () => setGizmo("off");
function setGizmo(mode) {
  if (mode === "off" || (mode === gzMode && gzOn)) gzOn = false; else { gzOn = true; gzMode = mode; }
  try { localStorage.setItem("meshsplit:gizmo", gzOn ? gzMode : "off"); } catch {}
  if (gzOn && S.tool !== "orbit") setTool("orbit");
  syncGizmo();
}
document.querySelectorAll("#gzModes [data-gz]").forEach((b) => (b.onclick = () => setGizmo(b.dataset.gz)));
gizmo.addEventListener("dragging-changed", (e) => {
  controls.enabled = !e.value;
  const i = S.active;
  if (e.value) {
    gzSnap = snapshot(); const x = ensureXf(i);
    const jf = gizmo.mode === "rotate" && gzJointOn && i > 0 ? jointFrame(i) : null;
    gzJoint = jf && { ...jf, q0: gzProxy.quaternion.clone(), r0: new THREE.Quaternion().setFromEuler(new THREE.Euler(...x.r.map((d) => d * Math.PI / 180), "XYZ")),
      p0: new THREE.Vector3(...x.c).add(new THREE.Vector3(...x.t)) };
    return;
  }
  gzJoint = null;
  if (gzSnap) { pushUndo(gzSnap); gzSnap = null; }
  refreshUI(); autosave();
});
gizmo.addEventListener("objectChange", () => {
  const i = S.active; if (gzSync || i <= 0 || !S.parts[i]) return;
  const x = ensureXf(i), r2d = 180 / Math.PI;
  if (gzJoint) { // keep only the twist about the joint axis, then rotate the part about the joint's center
    const d = gzProxy.quaternion.clone().multiply(gzJoint.q0.clone().invert()), n = gzJoint.n;
    const tw = new THREE.Quaternion(n.x * (d.x*n.x + d.y*n.y + d.z*n.z), n.y * (d.x*n.x + d.y*n.y + d.z*n.z), n.z * (d.x*n.x + d.y*n.y + d.z*n.z), d.w);
    if (tw.lengthSq() < 1e-12) tw.identity(); else tw.normalize();
    const e = new THREE.Euler().setFromQuaternion(tw.clone().multiply(gzJoint.r0), "XYZ");
    const p = gzJoint.p0.clone().sub(gzJoint.J).applyQuaternion(tw).add(gzJoint.J);
    x.r = [e.x, e.y, e.z].map((v) => +(v * r2d).toFixed(2));
    x.t = [0, 1, 2].map((k) => +(p.getComponent(k) - x.c[k]).toFixed(3));
    gzSync = true; gzProxy.quaternion.copy(tw.multiply(gzJoint.q0)); gzProxy.position.copy(gzJoint.J); gzSync = false;
    xfEdited(i); applyXf(); syncReps(); drawSeeds(); showXfDims();
    for (let k = 0; k < 3; k++) { xfIn("R", k).value = +x.r[k].toFixed(2); xfIn("T", k).value = +x.t[k].toFixed(3); }
    return;
  }
  if (gizmo.mode === "translate" && gzSlide !== "free") { // Move along plate / joint: only the position changes
    const z = x.t[2];
    x.t = [0, 1, 2].map((k) => +(gzProxy.position.getComponent(k) - x.c[k]).toFixed(3));
    if (gzSlide === "plate") x.t[2] = z;
    xfEdited(i); applyXf(); syncReps(); drawSeeds(); showXfDims();
    for (let k = 0; k < 3; k++) xfIn("T", k).value = +x.t[k].toFixed(3);
    return;
  }
  const sc = gzProxy.scale.toArray().map((v) => (Math.abs(v) < 0.01 ? (v < 0 ? -0.01 : 0.01) : v));
  if (gizmo.mode === "scale" && $("xfLock").checked) { // a single-axis drag scales all three when "uniform" is on
    const k = [0, 1, 2].reduce((a, j) => (Math.abs(sc[j] - x.s[j]) > Math.abs(sc[a] - x.s[a]) ? j : a), 0), f = sc[k] / (x.s[k] || 1);
    for (let j = 0; j < 3; j++) sc[j] = x.s[j] * f;
    gzSync = true; gzProxy.scale.set(...sc); gzSync = false;
  }
  x.s = sc.map((v) => +v.toFixed(4));
  x.r = [gzProxy.rotation.x, gzProxy.rotation.y, gzProxy.rotation.z].map((v) => +(v * r2d).toFixed(2));
  x.t = [0, 1, 2].map((k) => +(gzProxy.position.getComponent(k) - x.c[k]).toFixed(3));
  xfEdited(i); applyXf(); syncReps(); drawSeeds(); showXfDims();
  for (let k = 0; k < 3; k++) { xfIn("S", k).value = +(x.s[k] * 100).toFixed(2); xfIn("R", k).value = +x.r[k].toFixed(2); xfIn("T", k).value = +x.t[k].toFixed(3); }
});
function gizmoSnap(on) {
  gizmo.setTranslationSnap(on ? 1 : null);
  gizmo.setRotationSnap(on ? THREE.MathUtils.degToRad(15) : null);
  gizmo.setScaleSnap(on ? 0.05 : null);
}
window.addEventListener("keydown", (e) => { if (e.key === "Shift") gizmoSnap(true); });
window.addEventListener("keyup", (e) => { if (e.key === "Shift") gizmoSnap(false); });
window.addEventListener("blur", () => gizmoSnap(false));

let pickingJoint = false;
function pickJointAt(ev) {
  pickingJoint = false;
  const p = S.parts[S.active], m = p?.rep && repMeshes.get(p.rep.id);
  if (!m) { refreshUI(); return; }
  const r = renderer.domElement.getBoundingClientRect();
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
  m.updateMatrixWorld();
  const h = rc.intersectObject(m, false)[0];
  if (!h) { status("Missed the replacement; Pick joint again"); refreshUI(); return; }
  const lp = m.worldToLocal(h.point.clone());
  repEdit((rp) => { rp.joint = { p: lp.toArray(), n: h.face.normal.toArray() }; rp.flip = false; }, "Joint set on the replacement");
}
$("repBtn").onclick = () => $("repIn").click();
$("repIn").onchange = async () => {
  const f = $("repIn").files[0]; $("repIn").value = ""; if (!f) return;
  busy(true); try { await replaceActive(f); } catch (e) { console.error(e); alert(e.message); } busy(false);
};
$("repDel").onclick = () => { const p = S.parts[S.active]; if (!p?.rep) return; pushUndo(); delete p.rep; afterEdit(`${p.name}: replacement removed`); };
$("repFlip").onclick = () => repEdit((r) => { if (r.joint) r.joint = null; else r.flip = !r.flip; }, "Flipped joint end");
$("repRoll").onclick = () => repEdit((r) => { r.roll = ((r.roll || 0) + 90) % 360; }, "Rolled 90°");
$("repPick").onclick = () => {
  const p = S.parts[S.active]; if (!p?.rep) return;
  if (p.rep.joint && !pickingJoint) { repEdit((r) => { r.joint = null; }, "Joint back to auto"); return; }
  pickingJoint = !pickingJoint; refreshUI(); status(pickingJoint ? "Click the replacement where it attaches" : "");
};
$("repKeep").onchange = () => repEdit((r) => { r.inPlace = $("repKeep").checked; }, $("repKeep").checked ? "Kept in place" : "Lined up on the joint");
$("repFit").onchange = () => repEdit((r) => { r.fit = $("repFit").checked; }, $("repFit").checked ? "Fit to old part" : "Original size");
$("repEmbed").onchange = () => repEdit((r) => { r.embed = Math.max(0, +$("repEmbed").value || 0); }, "Embed changed");

// ---------------------------------------------------------------- AI review
// Layer 2 on top of the geometric split: renders labeled views + per-part stats, asks a vision model
// (via the local server -> OpenRouter, key stays server-side) to name parts and flag segmentation problems.
const VIEWS = [
  { name: "front (camera at -Y)", d: [0, -1, 0.12] }, { name: "back (+Y)", d: [0, 1, 0.12] },
  { name: "left (-X)", d: [-1, 0, 0.12] }, { name: "right (+X)", d: [1, 0, 0.12] },
  { name: "top (+Z)", d: [0, -0.02, 1] }, { name: "front-left iso", d: [-0.8, -1, 0.7] },
];
let shotR = null;
const shotCam = new THREE.PerspectiveCamera(30, 1, 0.1, 10000);
function shoot(view, w, h, mode) {
  if (!shotR) { shotR = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); scene.add(shotCam); }
  shotR.setPixelRatio(1); shotR.setSize(w, h, false);
  const geo = mesh.geometry, box = new THREE.Box3().setFromBufferAttribute(geo.getAttribute("position"));
  for (const m of repMeshes.values()) if (m.visible) { m.updateMatrixWorld(); box.union(new THREE.Box3().setFromObject(m)); }
  const sp = box.getBoundingSphere(new THREE.Sphere()), d = new THREE.Vector3(...view.d).normalize();
  const dist = sp.radius / Math.sin((shotCam.fov / 2) * Math.PI / 180) * 1.02;
  shotCam.aspect = w / h; shotCam.near = dist / 100; shotCam.far = dist * 4;
  shotCam.up.set(0, 0, 1); if (Math.abs(d.z) > 0.95) shotCam.up.set(0, 1, 0);
  shotCam.position.copy(sp.center).addScaledVector(d, dist); shotCam.lookAt(sp.center); shotCam.updateProjectionMatrix();
  shotCam.add(key); // headlight follows the shot camera
  const bg = scene.background, sv = seedGroup.visible, bv = brushRing?.visible;
  seedGroup.visible = false; if (brushRing) brushRing.visible = false; if (plate) plate.visible = false;
  if (mode === "id") {
    scene.background = null; shotR.setClearColor(0x000000, 1); shotR.outputColorSpace = THREE.LinearSRGBColorSpace;
    const col = geo.getAttribute("color"), keep = col.array, ids = new Float32Array(keep.length);
    for (let f = 0; f < S.nF; f++) { const l = S.labels[f] + 1, r = (l & 255) / 255, g = (l >> 8) / 255; for (let k = 0; k < 9; k += 3) { ids[9*f+k] = r; ids[9*f+k+1] = g; } }
    const saved = keep.slice(); keep.set(ids); col.needsUpdate = true; mesh.material = idMat;
    const rmats = [];
    for (const m of [...repMeshes.values(), ...trimMeshes.values()]) { const l = m.userData.part + 1; rmats.push([m, m.material]); m.material = new THREE.MeshBasicMaterial({ color: new THREE.Color((l & 255) / 255, (l >> 8) / 255, 0), toneMapped: false, side: THREE.DoubleSide }); }
    if (fillMesh) fillMesh.visible = false;
    shotR.render(scene, shotCam);
    if (fillMesh) fillMesh.visible = true;
    for (const [m, mat] of rmats) { m.material.dispose(); m.material = mat; }
    keep.set(saved); col.needsUpdate = true; mesh.material = material;
  } else {
    shotR.outputColorSpace = THREE.SRGBColorSpace;
    shotR.render(scene, shotCam);
  }
  scene.background = bg; seedGroup.visible = sv; if (brushRing) brushRing.visible = bv; if (plate) plate.visible = true;
  camera.add(key);
  return shotR.domElement;
}
const idMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide });

// Per part: visible pixel count and the most interior visible pixel (label anchor), via a chamfer
// distance transform over the ID image; anti-aliased edge pixels sit at distance ~1 and never win.
function idAnalyze(cv, nParts) {
  const w = cv.width, h = cv.height, c2 = document.createElement("canvas"); c2.width = w; c2.height = h;
  const cx = c2.getContext("2d"); cx.drawImage(cv, 0, 0);
  const px = cx.getImageData(0, 0, w, h).data, id = new Int32Array(w * h), D = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) id[i] = px[4*i] + px[4*i+1] * 256 - 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, v = id[i];
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || id[i-1] !== v || id[i+1] !== v || id[i-w] !== v || id[i+w] !== v;
    D[i] = edge ? 0 : 1e9;
  }
  for (let y = 1; y < h; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; D[i] = Math.min(D[i], D[i-1] + 1, D[i-w] + 1, D[i-w-1] + 1.4, D[i-w+1] + 1.4); }
  for (let y = h - 2; y >= 0; y--) for (let x = w - 2; x > 0; x--) { const i = y * w + x; D[i] = Math.min(D[i], D[i+1] + 1, D[i+w] + 1, D[i+w+1] + 1.4, D[i+w-1] + 1.4); }
  const count = new Int32Array(nParts), best = Array.from({ length: nParts }, () => ({ d: -1, x: 0, y: 0 }));
  for (let i = 0; i < w * h; i++) {
    const v = id[i]; if (v < 0 || v >= nParts) continue;
    count[v]++;
    if (D[i] > best[v].d) best[v] = { d: D[i], x: i % w, y: (i / w) | 0 };
  }
  return { count, best };
}

function label(cx, x, y, text, size = 15) {
  cx.font = `600 ${size}px system-ui,Segoe UI,sans-serif`; cx.textAlign = "center"; cx.textBaseline = "middle";
  cx.lineWidth = 4; cx.strokeStyle = "#000"; cx.strokeText(text, x, y); cx.fillStyle = "#fff"; cx.fillText(text, x, y);
}

function captureForNaming(stats) {
  const nP = S.parts.length, vis = S.parts.map((p) => p.visible);
  gizmo.detach(); setTimeout(syncGizmo, 0);
  S.parts.forEach((p) => (p.visible = true)); updateVisibility(); updateColors(true);
  try {
    const T = 448, cols = 3, over = document.createElement("canvas"); over.width = T * cols; over.height = T * 2;
    const ox = over.getContext("2d"), perView = [];
    VIEWS.forEach((v, n) => {
      const a = idAnalyze(shoot(v, T, T, "id"), nP); perView.push(a);
      const x0 = (n % cols) * T, y0 = Math.floor(n / cols) * T;
      ox.drawImage(shoot(v, T, T, "color"), x0, y0);
      ox.strokeStyle = "#555"; ox.strokeRect(x0 + 0.5, y0 + 0.5, T - 1, T - 1);
      ox.font = "12px system-ui"; ox.fillStyle = "#ccc"; ox.textAlign = "left"; ox.textBaseline = "top"; ox.fillText(v.name, x0 + 6, y0 + 5);
      for (let i = 0; i < nP; i++) if (a.count[i] >= 40 && a.best[i].d >= 3) label(ox, x0 + a.best[i].x, y0 + a.best[i].y, `#${i}`);
    });
    // contact sheet: each part highlighted from the view that shows most of it
    const cnt = partCounts();
    const list = S.parts.map((_, i) => i).filter((i) => cnt[i] > 0 && (i > 0 || cnt[0] > 0)).sort((a, b) => cnt[b] - cnt[a]).slice(0, 16).sort((a, b) => a - b);
    const t = 256, sc = 4, sheet = document.createElement("canvas"); sheet.width = t * sc; sheet.height = t * Math.ceil(list.length / sc);
    const sx = sheet.getContext("2d"); sx.fillStyle = "#202329"; sx.fillRect(0, 0, sheet.width, sheet.height);
    const col = mesh.geometry.getAttribute("color"), keep = col.array.slice(), dim = new THREE.Color("#9097a0").convertSRGBToLinear();
    list.forEach((i, n) => {
      let bv = 0; for (let v = 1; v < VIEWS.length; v++) if (perView[v].count[i] > perView[bv].count[i]) bv = v;
      const c = new THREE.Color(S.parts[i].color).convertSRGBToLinear();
      for (let f = 0; f < S.nF; f++) { const u = S.labels[f] === i ? c : dim; for (let k = 0; k < 9; k += 3) { col.array[9*f+k] = u.r; col.array[9*f+k+1] = u.g; col.array[9*f+k+2] = u.b; } }
      col.needsUpdate = true;
      for (const m of repMeshes.values()) m.material.color.set(m.userData.part === i ? S.parts[i].color : "#9097a0");
      const x0 = (n % sc) * t, y0 = Math.floor(n / sc) * t;
      sx.drawImage(shoot(VIEWS[bv], t, t, "color"), x0, y0);
      sx.strokeStyle = "#555"; sx.strokeRect(x0 + 0.5, y0 + 0.5, t - 1, t - 1);
      sx.font = "600 13px system-ui"; sx.fillStyle = "#fff"; sx.textAlign = "left"; sx.textBaseline = "top";
      sx.fillText(`#${i}  ${S.parts[i].name}`.slice(0, 34), x0 + 6, y0 + 5);
      sx.font = "11px system-ui"; sx.fillStyle = "#aaa"; sx.fillText(VIEWS[bv].name, x0 + 6, y0 + t - 17);
    });
    col.array.set(keep); col.needsUpdate = true;
    updateColors();
    return {
      images: [over.toDataURL("image/jpeg", 0.85), sheet.toDataURL("image/jpeg", 0.85)],
      captions: ["Image 1: six views, every part in its own color, labeled #id at its most visible spot.",
                 "Image 2: one tile per part (#id + current name), that part in color, the rest dark gray."],
    };
  } finally {
    S.parts.forEach((p, i) => (p.visible = vis[i])); updateVisibility(); render();
  }
}

// Geometry facts the model can't see well: fragments (part made of several disconnected patches), cut loops, size.
function partStats() {
  const G = S.G, n = S.parts.length, cnt = partCounts(), area = new Float64Array(n);
  let tot = 0; for (let f = 0; f < S.nF; f++) { area[S.labels[f]] += G.area[f]; tot += G.area[f]; }
  const comp = new Int32Array(S.nF).fill(-1), frags = Array.from({ length: n }, () => []), stack = [];
  for (let s = 0; s < S.nF; s++) {
    if (comp[s] >= 0) continue;
    const L = S.labels[s]; let a = 0; comp[s] = s; stack.push(s);
    while (stack.length) {
      const f = stack.pop(); a += G.area[f];
      for (let k = G.adjS[f]; k < G.adjS[f + 1]; k++) { const g = G.adjN[k]; if (comp[g] < 0 && S.labels[g] === L) { comp[g] = s; stack.push(g); } }
    }
    frags[L].push({ face: s, area: a });
  }
  const gb = new THREE.Box3().setFromBufferAttribute(mesh.geometry.getAttribute("position"));
  const gs = gb.getSize(new THREE.Vector3());
  const r = (v, d = 1) => +v.toFixed(d);
  const parts = S.parts.map((p, i) => {
    if (!cnt[i]) return null;
    const b = partWorldBox(i), fr = frags[i].sort((x, y) => y.area - x.area);
    return {
      id: i, name: p.name, color: p.color, faces: cnt[i], area_pct: r(100 * area[i] / tot, 2),
      bbox_mm: [r(b[3]-b[0]), r(b[4]-b[1]), r(b[5]-b[2])],
      center_frac: [0, 1, 2].map((k) => r(((b[k] + b[k+3]) / 2 - gb.min.getComponent(k)) / (gs.getComponent(k) || 1), 2)),
      fragments: fr.length, stray_area_pct_of_part: r(100 * fr.slice(1).reduce((s, x) => s + x.area, 0) / (area[i] || 1), 2),
      cut_loops: i ? partMesh(i)?.loops ?? 0 : undefined, transformed: !isIdXf(p.xf) || undefined,
      replaced_with: hasRep(p) ? p.rep.name : undefined,
      _frags: fr,
    };
  }).filter(Boolean);
  return {
    file: S.name, faces: S.nF, shells: G.shells, model_bbox_mm: [r(gs.x), r(gs.y), r(gs.z)],
    axes: "Z up; front faces -Y; center_frac is the part center as 0..1 of the model bbox (x right, y back, z up)",
    parts,
  };
}
const statsForLLM = (st) => ({ ...st, parts: st.parts.map(({ _frags, ...p }) => p) });

function localChecks(st) {
  const out = [], un = st.parts.find((p) => p.id === 0);
  if (un) out.push({ severity: un.area_pct > 5 ? "high" : "medium", parts: [0], problem: `${un.faces.toLocaleString()} faces still Unassigned (${un.area_pct}% of area)`,
    fix: "Seed them into a part and Segment, or Fill/Brush them" });
  for (const p of st.parts) {
    if (p.id === 0) continue;
    if (p.fragments > 1) out.push({ severity: p.stray_area_pct_of_part > 2 ? "high" : p.stray_area_pct_of_part > 0.2 ? "medium" : "low", parts: [p.id],
      problem: `#${p.id} ${p.name} is in ${p.fragments} disconnected pieces (${p.stray_area_pct_of_part}% of its area is stray)`,
      fix: "Smooth, or Brush/Fill the stray pieces into the neighbor; each piece becomes its own body in Part STLs" });
    if (p.area_pct < 0.2) out.push({ severity: "low", parts: [p.id], problem: `#${p.id} ${p.name} is a sliver (${p.area_pct}% of area, ${p.faces} faces)`,
      fix: "Merge it into its neighbor unless it is a real detail" });
  }
  for (const p of st.parts) { // a closed part that encloses negative volume prints as nothing or as a hole
    if (p.id === 0) continue;
    const v = partSoup(p.id);
    if (v?.length && core.soupVolume(v) < 0) out.push({ severity: "high", parts: [p.id], problem: `#${p.id} ${p.name} is inside out as a separate solid (a recess with more than one cut)`,
      fix: "Merge it into the part it is cut into, or Brush its rim so it has a single cut" });
  }
  for (const h of hits) if (S.parts[h[0]] && S.parts[h[1]]) out.push({ severity: "high", parts: h, problem: hitText(h),
    fix: "Move, rotate or stretch one of them (e.g. stretch the arms that hold it) until the warning clears" });
  return out;
}

let lastNaming = null;
// Where AI naming requests go: inside OrcaSlicer the plugin makes them (window.orca messages); in the browser the
// local server does (/api/llm/*), and there the page never holds the saved key. The hosted app has no server: it sends
// straight from the browser to the provider (llm-direct.js), with the key kept in this browser. Nothing is sent until a click.
const IN_ORCA = !!(window.orca && window.orca.postMessage);
let DIRECT = null; // llm-direct.js once we know there is no local server
const DIRECT_JS = "./llm-direct.js"; // a variable, so the plugin bundle leaves it out (never used inside OrcaSlicer)
async function llmServerOrDirect() {
  if (DIRECT) return DIRECT;
  try {
    const r = await fetch("/api/llm/status");
    if (r.ok && (r.headers.get("Content-Type") || "").includes("json")) return null;
  } catch {}
  DIRECT = (await import(DIRECT_JS)).directLLM();
  return DIRECT;
}
const LLM = { st: null, wait: new Map(), prog: new Map(), seq: 0, models: {}, job: null, warned: "" };
function llmAsk(msgs, key, ms = 30000) { // plugin round trip: resolves with the reply that carries `key`
  return new Promise((res, rej) => {
    LLM.wait.set(key, res); for (const m of msgs) window.orca.postMessage(m);
    setTimeout(() => { if (LLM.wait.delete(key)) rej(new Error("No reply from the plugin")); }, ms);
  });
}
function llmReply(m) { // called from the plugin bridge for llm_* messages
  if (m.cmd === "llm_progress") { LLM.prog.get(m.id)?.(m); return; }
  const key = m.cmd === "llm_result" ? m.id : m.cmd, f = LLM.wait.get(key);
  if (m.cmd === "llm_result") LLM.prog.delete(m.id);
  if (f) { LLM.wait.delete(key); f(m); }
}
async function llmApi(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  return r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
}
const llmGetStatus = async () => IN_ORCA ? llmAsk([{ cmd: "llm_status" }], "llm_status") : (await llmServerOrDirect())?.status() ?? llmApi("/api/llm/status");
const llmSaveSettings = (settings) => IN_ORCA ? llmAsk([{ cmd: "llm_settings", settings }], "llm_status") : DIRECT ? DIRECT.saveSettings(settings) : llmApi("/api/llm/settings", settings);
// Connection test: reaches the provider, checks the key and the model (no model data sent). 60 s: OrcaSlicer may ask first.
const llmTest = () => (IN_ORCA ? llmAsk([{ cmd: "llm_test" }], "llm_test", 60000) : DIRECT ? DIRECT.test() : llmApi("/api/llm/test")).catch((e) => ({ ok: false, error: e.message, models: [] }));
const PAGE_LIMIT = 16 * 60000; // the plugin / server always answers within its own limit (15 min for a local model)
// One naming request. onProgress gets {stage, chars, reasoning, bytes}; signal (an AbortController's) cancels it.
async function llmSendName(body, onProgress, signal) {
  const cancelled = { ok: false, cancelled: true, error: "Cancelled" };
  if (DIRECT) return DIRECT.nameParts(body, onProgress, signal);
  if (!IN_ORCA) {
    let r;
    try { r = await fetch("/api/llm/name-parts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal }); }
    catch (e) { if (signal.aborted) return cancelled; throw e; }
    if (!r.body || !(r.headers.get("Content-Type") || "").includes("ndjson")) return r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "", last = null;
    try {
      for (;;) {
        const { value, done } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
          const m = JSON.parse(line); if (m.progress) onProgress({ ...m, stage: m.progress }); else last = m;
        }
      }
    } catch (e) { if (signal.aborted) return cancelled; throw e; }
    return last || { ok: false, error: "The local server closed the connection without an answer" };
  }
  const t = JSON.stringify(body), id = `n${Date.now().toString(36)}-${++LLM.seq}`, n = Math.max(1, Math.ceil(t.length / (512 * 1024)));
  const parts = Array.from({ length: n }, (_, i) => ({ cmd: "llm_name", id, part: i, of: n, data: t.slice(i * 512 * 1024, (i + 1) * 512 * 1024) }));
  LLM.prog.set(id, onProgress);
  signal.addEventListener("abort", () => {
    window.orca.postMessage({ cmd: "llm_cancel", id });
    LLM.prog.delete(id); const f = LLM.wait.get(id); if (f) { LLM.wait.delete(id); f(cancelled); }
  });
  try { return await llmAsk(parts, id, PAGE_LIMIT); }
  catch (e) { LLM.prog.delete(id); window.orca.postMessage({ cmd: "llm_cancel", id }); throw e; }
}
const llmWho = (j) => j.provider === "custom" ? (j.base_url || "").replace(/^https?:\/\//, "") : j.label;
function llmShow(j) {
  LLM.st = j;
  $("aiState").innerHTML = j.configured ? `${esc(llmWho(j))} · <b style="color:var(--fg)">${esc(j.model || "the loaded model")}</b>` : "No AI model connected yet.";
  $("aiState").title = j.configured ? `${j.label}${j.has_key ? ` · key ${j.source === "saved" ? "saved" : `from ${j.key_note || j.source}`}` : ""}` : "";
  $("aiChange").textContent = j.configured ? "Change" : "Connect";
  $("aiBtn").disabled = !j.configured;
  llmFillModels(j.provider);
  return j;
}
const MODEL_HINTS = {
  openrouter: ["deepseek/deepseek-v4.1-flash", "google/gemini-2.5-flash", "google/gemini-2.5-pro", "anthropic/claude-opus-5-5", "openai/gpt-5-mini"],
  openai: ["gpt-5-mini", "gpt-5", "gpt-4.1-mini"],
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  custom: [],
};
const KEY_HELP = { openrouter: "Get a key at openrouter.ai/keys", openai: "Get a key at platform.openai.com/api-keys",
  anthropic: "Get a key at console.anthropic.com", custom: "LM Studio, Ollama and other OpenAI-compatible servers. Key optional." };
function llmFillModels(pid) {
  const list = [...new Set([...(MODEL_HINTS[pid] || []), ...(LLM.models[pid] || [])])];
  $("aiModels").innerHTML = list.map((m) => `<option value="${esc(m)}">`).join("");
}
function llmFillSettings(pid) {
  const j = LLM.st, p = j.providers.find((x) => x.id === pid) || j.providers[0], cur = pid === j.provider;
  $("aiProv").innerHTML = j.providers.map((x) => `<option value="${x.id}">${esc(x.label)}</option>`).join(""); $("aiProv").value = p.id;
  $("aiUrlRow").hidden = p.id !== "custom";
  $("aiUrl").value = cur && p.id === "custom" ? j.base_url : p.base_url;
  $("aiKey").value = "";
  const hasKey = cur && j.has_key;
  $("aiKey").placeholder = hasKey ? (j.source === "saved" ? "saved (type to replace)" : `set by ${j.key_note || j.source}`) : p.needs_key ? "paste your API key" : "optional";
  $("aiKeyNote").textContent = (KEY_HELP[p.id] || "") + (j.in_browser && p.needs_key ? ". The key is saved in this browser only and sent only to this provider." : "");
  $("aiModel").value = cur ? j.model : p.model;
  $("aiModel").placeholder = p.id === "custom" ? "blank: the model loaded in the server" : "model id";
  $("aiForget").hidden = !(hasKey && j.source === "saved");
  llmFillModels(p.id); llmConnNote("");
}
function llmConnNote(text, kind = "") { $("aiConn").hidden = !text; $("aiConn").textContent = text; $("aiConn").className = `small ${kind}`; }
function llmSettings(on) {
  if (on && !LLM.st) return;
  $("aiSet").hidden = !on; $("aiMain").hidden = on;
  if (on) { llmFillSettings(LLM.st.provider); $("aiSetCancel").hidden = !LLM.st.configured; LLM.warned = ""; (LLM.st.needs_key && !LLM.st.has_key ? $("aiKey") : $("aiModel")).focus(); }
}
async function llmStatus() {
  if (!IN_ORCA && location.protocol === "file:") { $("aiState").textContent = "AI naming needs the local server: uv run mesh-splitter"; $("aiBtn").disabled = true; $("aiChange").hidden = true; return { configured: false }; }
  try { return llmShow(await llmGetStatus()); }
  catch { $("aiState").textContent = IN_ORCA ? "The plugin is not answering. Reopen the Mesh Splitter tab." : "The local server is not running."; return { configured: false }; }
}
// Connect: save the settings, then test them. Closes on success; a warning (e.g. unknown model) closes on the second click.
async function llmSave(extra = {}) {
  const pid = $("aiProv").value, patch = { provider: pid, model: $("aiModel").value.trim(), ...extra };
  if (pid === "custom") patch.base_url = $("aiUrl").value.trim();
  if ($("aiKey").value.trim()) patch.api_key = $("aiKey").value.trim();
  const sig = JSON.stringify([patch.provider, patch.model, patch.base_url]);
  const j = await llmSaveSettings(patch).catch((e) => ({ ok: false, error: e.message }));
  if (j.ok === false) { llmConnNote(j.error, "bad"); return; }
  $("aiKey").value = ""; llmShow(j); llmFillSettings(j.provider); $("aiSetCancel").hidden = !j.configured;
  if (extra.clear_key) { llmConnNote("Key deleted.", ""); return; }
  if (!j.configured) { llmConnNote(`Paste your ${j.label} API key, then click Connect.`, "bad"); $("aiKey").focus(); return; }
  if (LLM.warned === sig) { llmSettings(false); return; }
  llmConnNote(`Checking ${llmWho(j)}…${IN_ORCA ? " Click Yes if OrcaSlicer asks to allow the connection." : ""}`);
  $("aiSave").disabled = true;
  const t = await llmTest(); $("aiSave").disabled = false;
  if (t.models?.length) { LLM.models[j.provider] = t.models; llmFillModels(j.provider); }
  if (!t.ok) { llmConnNote(t.error || "Could not connect.", "bad"); return; }
  if (t.warning) { LLM.warned = sig; llmConnNote(`${t.warning} Click Connect again to use it anyway.`, "warn"); return; }
  llmConnNote(`Connected to ${llmWho(j)}.`, "ok"); status(`AI naming uses ${llmWho(j)} · ${j.model || "the loaded model"}`);
  setTimeout(() => { if (!$("aiSet").hidden && $("aiConn").classList.contains("ok")) llmSettings(false); }, 700);
}
$("aiChange").onclick = () => llmSettings(true);
$("aiSetCancel").onclick = () => llmSettings(false);
$("aiProv").onchange = () => { llmFillSettings($("aiProv").value); $("aiSetCancel").hidden = !LLM.st.configured; };
$("aiSave").onclick = () => llmSave();
$("aiForget").onclick = () => llmSave({ clear_key: true });
for (const id of ["aiKey", "aiUrl", "aiModel"]) $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") llmSave(); });

const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function renderNaming(R) {
  const o = $("aiOut"), nP = S.parts.length; o.innerHTML = "";
  const ai = R.ai, add = (h) => o.insertAdjacentHTML("beforeend", h);
  if (R.error) add(`<div class="iss high">${esc(R.error)}${R.raw ? `<div class="fix">${esc(R.raw.slice(0, 300))}</div>` : ""}</div>`);
  if (ai?.object || ai?.summary) add(`<div class="small" style="margin-top:4px"><b style="color:var(--fg)">${esc(ai.object || "")}</b> ${esc(ai.summary || "")}</div>`);
  const names = (ai?.parts || []).filter((p) => Number.isInteger(p.id) && p.id > 0 && p.id < nP && p.name);
  if (names.length) {
    add(`<div class="sec">Names</div>`);
    const box = document.createElement("div"); o.appendChild(box);
    for (const p of names) {
      const cur = S.parts[p.id], row = document.createElement("label"); row.className = "nm";
      const conf = typeof p.confidence === "number" ? ` (${Math.round(p.confidence * 100)}%)` : "";
      row.title = `Now: ${cur.name}${conf}`;
      row.innerHTML = `<input type="checkbox" ${p.name !== cur.name && (p.confidence ?? 1) >= 0.4 ? "checked" : ""}><span><span class="sw" style="background:${esc(cur.color)}"></span> #${p.id}</span><input type="text" value="${esc(p.name)}">`;
      row.dataset.id = p.id; box.appendChild(row);
    }
    const b = document.createElement("button"); b.innerHTML = icon("check") + "Apply names"; b.style.marginTop = "4px";
    b.onclick = () => {
      const rows = [...box.querySelectorAll(".nm")].filter((r) => r.querySelector("input[type=checkbox]").checked);
      if (!rows.length) return;
      pushUndo();
      for (const r of rows) { const v = r.querySelector("input[type=text]").value.trim(); if (v) S.parts[+r.dataset.id].name = v; }
      afterEdit(`Renamed ${rows.length} part(s)`);
    };
    o.appendChild(b);
  }
  const issues = [...(R.checks || []).map((x) => ({ ...x, src: "check" })), ...(ai?.issues || []).map((x) => ({ ...x, src: "AI" }))];
  if (issues.length || R.checks) add(`<div class="sec">Issues</div>`);
  if (!issues.length && R.checks && !R.pending) add(`<div class="small">None found.</div>`);
  for (const x of issues) {
    const ids = (x.parts || []).filter((i) => Number.isInteger(i) && i >= 0 && i < nP);
    const d = document.createElement("div"); d.className = `iss ${["high", "medium", "low"].includes(x.severity) ? x.severity : "low"}`;
    d.innerHTML = `${esc(x.problem)} <span class="small">· ${x.src}</span>${x.fix ? `<div class="fix">${esc(x.fix)}</div>` : ""}`;
    d.title = ids.length ? "Click: make the first part active and show only these parts (eye button shows all again)" : "";
    d.onclick = () => { if (!ids.length) return; S.active = ids[0]; S.parts.forEach((p, i) => (p.visible = ids.includes(i))); afterEdit(`Showing ${ids.map((i) => "#" + i).join(", ")}`); };
    o.appendChild(d);
  }
  if (R.images) {
    const urls = R.images.map((u) => { const b = atob(u.split(",")[1]), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return URL.createObjectURL(new Blob([a], { type: "image/jpeg" })); });
    add(`<div class="small" style="margin-top:6px">Sent: <a href="${urls[0]}" target="_blank" style="color:var(--acc)">views</a> · <a href="${urls[1]}" target="_blank" style="color:var(--acc)">part sheet</a>${R.usage ? ` · ${R.usage.prompt_tokens ?? "?"}+${R.usage.completion_tokens ?? "?"} tokens` : ""}</div>`);
  }
}

function runChecks() {
  if (!S.G) return;
  const st = partStats(), checks = localChecks(st); renderNaming({ checks });
  const o = $("aiOut"); o.style.animation = "none"; void o.offsetWidth; o.style.animation = "msFade .3s ease-out"; // shows a re-run with the same result
  o.scrollIntoView({ block: "nearest" });
  status(checks.length ? `Check parts: ${checks.length} issue${checks.length > 1 ? "s" : ""} found` : "Check parts: no issues found");
}
const mmss = (ms) => { const t = Math.floor(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
function aiProgress(job) { // the progress box: what is happening now, for how long, and Cancel
  const st = LLM.st || {}, who = llmWho(st), m = job.m || {}, secs = (Date.now() - job.since) / 1000;
  const text = {
    upload: "Handing the pictures to the plugin…",
    permission: "Asking OrcaSlicer to allow the connection…",
    sending: `Sending ${m.bytes ? `${(m.bytes / 1048576).toFixed(1)} MB ` : ""}to ${who}…`,
    waiting: "Waiting for the model to start answering…",
    thinking: "The model is thinking…",
    writing: "Receiving part names…",
  }[job.stage] || "Working…";
  const detail = job.stage === "permission" ? "Click Yes if OrcaSlicer asks."
    : job.stage === "thinking" ? `${(m.reasoning || 0).toLocaleString()} characters of reasoning so far.`
    : job.stage === "writing" ? `${(m.chars || 0).toLocaleString()} characters received.`
    : job.stage === "waiting" && secs > 20 ? `Connected. ${st.provider === "custom" ? "A local model can take a few minutes to read the pictures." : "Larger models can take a minute or two."}`
    : "";
  $("aiStage").textContent = text; $("aiDetail").textContent = detail; $("aiTime").textContent = mmss(Date.now() - job.t0);
}
async function runNaming() {
  if (!S.G || LLM.job) return;
  if (LLM.st && !LLM.st.configured) { showAi(true); llmSettings(true); return; }
  const model = LLM.st?.model || "", ac = new AbortController();
  const job = LLM.job = { t0: Date.now(), since: Date.now(), stage: "upload", ac };
  $("aiBtn").disabled = true; $("aiProg").hidden = false; $("aiStage").textContent = "Rendering views…"; $("aiDetail").textContent = ""; $("aiTime").textContent = "";
  await new Promise((r) => setTimeout(r, 30));
  let st, cap;
  try { st = partStats(); cap = captureForNaming(st); }
  catch (e) { console.error(e); LLM.job = null; $("aiProg").hidden = true; $("aiBtn").disabled = false; renderNaming({ error: e.message }); return; }
  const checks = localChecks(st);
  renderNaming({ checks, images: cap.images });
  const tick = setInterval(() => aiProgress(job), 500); aiProgress(job);
  const onProgress = (m) => { if (m.stage !== job.stage) job.since = Date.now(); job.stage = m.stage; job.m = m; aiProgress(job); };
  try {
    const j = await llmSendName({ model, images: cap.images, captions: cap.captions, stats: statsForLLM(st), hint: $("aiNote").value }, onProgress, ac.signal);
    lastNaming = j;
    if (j.cancelled) { renderNaming({ checks, images: cap.images }); status("AI naming cancelled"); }
    else if (!j.ok) { renderNaming({ checks, error: j.error, raw: j.raw, images: cap.images }); status("AI naming failed"); }
    else { renderNaming({ checks, ai: j.result, images: cap.images, usage: j.usage }); status(`Named by ${j.model} in ${mmss(Date.now() - job.t0)}`); }
  } catch (e) {
    renderNaming({ checks, error: IN_ORCA ? `No answer from the plugin (${e.message}). Reopen the Mesh Splitter tab and try again.` : DIRECT ? e.message : `The local server stopped answering: ${e.message}`, images: cap.images });
  } finally { clearInterval(tick); LLM.job = null; $("aiProg").hidden = true; $("aiBtn").disabled = !LLM.st?.configured; }
}
$("aiStop").onclick = () => LLM.job?.ac.abort();
$("aiBtn").onclick = runNaming;
$("aiChk").onclick = () => { if (S.G) { showAi(true, false); runChecks(); } }; // local checks need no AI model

// ---------------------------------------------------------------- export
function download(name, data, type = "application/octet-stream") {
  if (ORCA.on) return ORCA.save(name, data);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function exportPainted3MF() {
  if (!S.G) return;
  const ch = changedParts();
  let fil = (f) => S.parts[S.labels[f]].filament, src = S;
  if (ch.size) { // moved/replaced parts: rebuild one mesh from the merged shells
    const m = mergedSoup(), w = weld(m.v, Uint32Array.from({ length: m.v.length / 3 }, (_, i) => i));
    src = { pos: w.pos, tri: w.tri, nV: w.pos.length / 3, nF: w.tri.length / 3 }; fil = (f) => m.fil[f];
  }
  // smoothed boundaries split faces: no 1:1 map to the file, so the source 3MF is only reused when untouched
  const keepSrc = S.source.type === "3mf" && !ch.size && S.tri === S.mesh0[1];
  const out = core.painted3MF(S.name, src, fil, keepSrc ? S.source : null);
  download(`${S.name}_painted.3mf`, out, "model/3mf");
  const fils = [...new Set(S.parts.filter((_, i) => partCounts()[i] > 0).map((p) => p.filament))].sort((a, b) => a - b);
  status(`Painted 3MF written. Uses filament slot(s) ${fils.join(", ")}; the slicer project needs at least ${Math.max(...fils)} filaments.` +
    (ch.size ? " Rebuilt from moved/replaced parts (overlaps fuse in the slicer); original 3MF settings not carried over." :
      S.source.type === "3mf" && S.tri !== S.mesh0[1] ? " Mesh rewritten for the smoothed boundaries; original 3MF settings not carried over." : ""));
}

// One closed mesh per part: the part's faces plus a fan cap over each open boundary loop.
const partMesh = (pi) => meshOf((l) => l === pi);
const meshOf = (inSet) => core.meshOf(S, inSet);

const hasRep = (p) => !!(p.rep && REPS.has(p.rep.id));
const changedParts = () => new Set(S.parts.map((_, i) => i).filter((i) => i > 0 && (hasRep(S.parts[i]) || !isIdXf(S.parts[i].xf))));
function xformSoup(v, M) {
  const out = Float32Array.from(v), t = new THREE.Vector3();
  for (let o = 0; o < out.length; o += 3) { t.fromArray(out, o).applyMatrix4(M); t.toArray(out, o); }
  if (M.determinant() < 0) for (let o = 0; o < out.length; o += 9) for (let k = 0; k < 3; k++) [out[o+3+k], out[o+6+k]] = [out[o+6+k], out[o+3+k]];
  return out;
}
// Final closed geometry of one part: its replacement, or its faces + caps, with the Transform applied.
function partSoup(i, raw = false) {
  const p = S.parts[i];
  if (!raw && trimOn(i)) { const t = trimResult(i); if (t) return t.pos; }
  if (hasRep(p)) { const M = repMatrix(i); return M ? xformSoup(REPS.get(p.rep.id).pos, M) : null; }
  const m = partMesh(i); if (!m) return null;
  const M = xfMatrix(p), faces = Float32Array.from(m.verts.slice(0, m.nFaceVerts)), ctx = fillCtx();
  const body = M ? healSoup(i, faces, xformSoup(faces, M)) : Float32Array.from(faces);
  // caps start exactly on the part's own (float32) boundary positions, so the closed solid has no slivers
  ctx.fixL = i; ctx.fix = new Map(); ctx.fixV = body; let o = 0;
  for (let f = 0; f < S.nF; f++) if (S.labels[f] === i) { for (let c = 0; c < 3; c++, o += 3) ctx.fix.set(S.tri[3*f+c], o); }
  const caps = capTris(loopPlans(m.loopList, ctx), ctx), out = new Float32Array(body.length + caps.length);
  out.set(body); out.set(caps, body.length); return out;
}
// Whole model as one triangle soup + filament per triangle. Unchanged parts keep their faces with the holes left by
// moved/replaced parts capped; each moved/replaced part is its own closed shell overlapping the rest (slicers union them).
function mergedSoup() {
  const ch = changedParts(), parts = [], fil = [];
  const rest = meshOf((l) => !ch.has(l));
  if (rest) {
    parts.push(rest.verts.slice(0, rest.nFaceVerts));
    rest.triLab.forEach((l) => fil.push(S.parts[l].filament));
    // holes left by moved/replaced parts: a Fill patch is the part's own surface (its filament); a cap hidden under
    // the moved part or its sleeve takes that part's filament
    const ctx = fillCtx();
    for (const pl of loopPlans(rest.loopList, ctx)) {
      const t = planTris(pl, ctx), f = S.parts[pl.kind === "patch" || pl.nb < 0 ? pl.own : pl.nb]?.filament ?? 1;
      parts.push(Float32Array.from(t)); for (let o = 0; o < t.length; o += 9) fil.push(f);
    }
  }
  for (const i of ch) { const v = partSoup(i); if (!v) continue; parts.push(v); for (let o = 0; o < v.length; o += 9) fil.push(S.parts[i].filament); }
  const n = parts.reduce((a, v) => a + v.length, 0), v = new Float32Array(n); let o = 0;
  for (const a of parts) { v.set(a, o); o += a.length; }
  return { v, fil };
}

// One object whose parts are the split parts (closed, transforms applied), each with its filament slot.
function buildParts3MF() {
  const cnt = partCounts(), soups = [];
  S.parts.forEach((p, i) => {
    if (!cnt[i] && !hasRep(p)) return;
    const v = partSoup(i); if (!v || !v.length) return;
    soups.push({ name: p.name, filament: p.filament, soup: v });
  });
  return core.parts3MF(S.name, soups);
}
function exportParts3MF() {
  if (!S.G) return;
  const { out, parts } = buildParts3MF();
  download(`${S.name}_parts.3mf`, out, "model/3mf");
  const fils = [...new Set(parts.map((p) => p.filament))].sort((a, b) => a - b);
  status(`Multi-part 3MF written: ${parts.length} part(s), filament slot(s) ${fils.join(", ")}.`);
  if (orcaFil?.length && fils[fils.length - 1] > orcaFil.length)
    alert(`Parts use filament slot ${fils[fils.length - 1]}, but OrcaSlicer has ${orcaFil.length} filaments. Add filaments in Orca or change the parts' F numbers.`);
}

function exportSTLs() {
  if (!S.G) return;
  const files = {}, cnt = partCounts(), names = new Set();
  S.parts.forEach((p, i) => {
    if (!cnt[i] && !hasRep(p)) return;
    const v = partSoup(i); if (!v) return;
    let nm = `${safe(S.name)}_${safe(p.name)}`; while (names.has(nm)) nm += "_"; names.add(nm);
    files[`${nm}.stl`] = stlBinary(v);
  });
  download(`${S.name}_parts.zip`, zipSync(files, { level: 6 }), "application/zip");
  status(`${Object.keys(files).length} STL(s) zipped; cut openings capped${S.parts.some(hasRep) ? ", replacements included" : ""}.`);
}
function exportMergedSTL() {
  if (!S.G) return;
  const m = mergedSoup();
  download(`${S.name}_merged.stl`, stlBinary(m.v), "model/stl");
  status(`Merged STL written (${(m.v.length / 9).toLocaleString()} triangles); moved/replaced parts overlap the rest and fuse in the slicer.`);
}

const sessCache = {};
function encodeSession() {
  const reps = {};
  for (const p of S.parts) if (hasRep(p) && !reps[p.rep.id]) { const R = REPS.get(p.rep.id); reps[p.rep.id] = { name: R.name, pos: R.pos }; }
  return core.encodeSession(S, reps, sessCache);
}
function applySession(txt) {
  const d = core.decodeSession(txt, S.mesh0[1].length / 3, S.coarse);
  S.labels = d.labels; S.parts = d.parts; S.active = 0;
  if (d.mesh) setMesh(d.mesh.pos, d.mesh.tri);
  else if (S.tri !== S.mesh0[1]) setMesh(...S.mesh0);
  for (const r of d.reps) if (!REPS.has(r.id)) addRep(r.name, r.pos, r.id);
}
function saveSession() { if (S.G) download(`${S.name}.split.json`, encodeSession(), "application/json"); }
function loadSession(txt) {
  const before = snapshot();
  try { applySession(txt); } catch (e) { alert(e.message); return; }
  pushUndo(before);
  afterEdit("Session loaded");
}
const autosaveKey = () => `meshsplit:${S.name}:${S.mesh0[1].length / 3}`;
function autosave() { try { localStorage.setItem(autosaveKey(), encodeSession()); } catch {} }
function restoreAutosave() {
  let txt = null;
  try { txt = localStorage.getItem(autosaveKey()) || (S.coarse && localStorage.getItem(`meshsplit:${S.name}:${S.coarse.faces}`)); } catch {}
  if (!txt) return false;
  try { applySession(txt); afterEdit(`Restored your last session on ${S.name}. Auto split (A) starts over.`); return true; } catch (e) { console.warn("autosave ignored:", e.message); return false; }
}
$("exp3mf").onclick = () => { closeMenus(); later(exportPainted3MF); };
$("expParts").onclick = () => { closeMenus(); later(exportParts3MF); };
$("expMain").onclick = () => { closeMenus(); later(exportParts3MF); };
$("expStl").onclick = () => { closeMenus(); later(exportSTLs); };
$("expMerged").onclick = () => { closeMenus(); later(exportMergedSTL); };
$("saveSess").onclick = () => { closeMenus(); saveSession(); };
$("loadSess").onclick = () => { closeMenus(); S.G ? $("sessIn").click() : alert("Open the mesh first."); };
$("sessIn").onchange = async () => { const f = $("sessIn").files[0]; if (f) loadSession(await f.text()); $("sessIn").value = ""; };

// ---------------------------------------------------------------- boot
document.querySelectorAll("[data-icon]").forEach((b) => b.insertAdjacentHTML("afterbegin", icon(b.dataset.icon)));
document.querySelectorAll("[data-icon-span]").forEach((b) => (b.innerHTML = icon(b.dataset.iconSpan)));
new ResizeObserver(resize).observe(view);
setTool("orbit"); syncSliders(); resize(); llmStatus(); renderRecent(); $("colorMode").classList.toggle("on", byFilament);
const qp = new URLSearchParams(location.search).get("file");
if (qp) {
  busy(true);
  fetch("/" + qp.replace(/^\/+/, "")).then((r) => { if (!r.ok) throw new Error(`${qp}: HTTP ${r.status}`); return r.arrayBuffer(); })
    .then((buf) => openBuf(qp.split("/").pop(), buf)).catch((e) => alert(e.message)).finally(() => busy(false));
}

// ---------------------------------------------------------------- OrcaSlicer plugin bridge
// Inside OrcaSlicer the host injects window.orca (postMessage/onMessage). The plugin sends plate meshes
// in base64 chunks and writes files the page exports. Send to Orca hands the split to OrcaSlicer itself
// (plugin/handoff.py): added as a new object, or replacing the object it came from, its plate, or filling that
// plate with copies (plugin/project3mf.py). Outside OrcaSlicer none of this runs.
const ORCA = { on: !!(window.orca && window.orca.postMessage), objects: [], rx: null, req: 0, saves: new Map(), seq: 0,
  nonce: Math.random().toString(36).slice(2, 8) }; // ids stay unique across page reloads (the plugin outlives the page)
const CHUNK = 512 * 1024; // base64 chars per message
function orcaSend(msg) { window.orca.postMessage(msg); }
function u8ToB64(b) { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
// send: { mode, source, colors } asks the plugin to put the 3MF into the open project and hand that to OrcaSlicer
// (see ORCA.send) instead of only saving it.
ORCA.save = (name, data, send = null) => {
  const b = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const t = u8ToB64(b), id = `${ORCA.nonce}-${++ORCA.seq}`, n = Math.max(1, Math.ceil(t.length / CHUNK));
  return new Promise((res, rej) => {
    ORCA.saves.set(id, { res, rej, name });
    for (let i = 0; i < n; i++) orcaSend({ cmd: "save", id, name, part: i, of: n, data: t.slice(i * CHUNK, (i + 1) * CHUNK), ...(send || {}) });
    status(send ? "Sending to OrcaSlicer…" : `Saving ${name}…`);
  }).then((m) => {
    if (m.note) { status(m.note); alert(m.note); }
    else status(`Saved ${m.path} · import it in OrcaSlicer with Ctrl+I`);
    return m.path;
  }).catch((e) => { status(`Save failed: ${e.message}`); alert(`Save failed: ${e.message}`); });
};
// Send to Orca. mode: add (a new object next to the original), replace_object, replace_plate or fill_plate
// (those three need the model opened from the plate: the plugin finds the original by its id). The plugin puts
// the split into a copy of the project and OrcaSlicer opens that as the project.
ORCA.send = (mode) => {
  if (!S.G) return;
  const src = S.source?.orca;
  if (mode !== "add" && !src) { alert("Open the model from the plate (Model > From the plate) to replace it there."); return; }
  const { out } = buildParts3MF();
  const colors = {}; // filament slot -> the part's color, for slots the project doesn't have yet
  for (const p of S.parts.slice(1)) colors[p.filament] ??= p.color;
  return ORCA.save(`${S.name}_parts.3mf`, out, { mode, colors, source: src ? { id: src.id, index: src.index, name: src.name } : null });
};
function orcaSendMenu() {
  const src = S.source?.orca;
  for (const id of ["sendReplace", "sendPlate", "sendFill"]) {
    $(id).dataset.tip ??= $(id).title;
    $(id).disabled = !src;
    $(id).title = src ? $(id).dataset.tip : "Open the model from the plate (Model > From the plate) to replace it there";
  }
  $("sendReplace").lastChild.textContent = src ? `Replace ${src.name}` : "Replace object";
}
function orcaRenderObjects() {
  for (const box of [$("orcaMenu"), $("dropOrca")]) {
    box.innerHTML = "";
    if (box === $("dropOrca") && ORCA.objects.length) box.insertAdjacentHTML("beforeend", `<div class="small" style="margin:8px 0 4px">From the plate:</div>`);
    for (const o of ORCA.objects) {
      const b = document.createElement("button"); b.title = o.name;
      b.innerHTML = `${icon("open")}<span style="overflow:hidden;text-overflow:ellipsis;max-width:320px">${esc(o.name)}</span><span class="meta">${o.faces.toLocaleString()} faces${o.parts > 1 ? ` · ${o.parts} parts` : ""}${o.ignored ? ` · ${o.ignored} modifier(s) ignored` : ""}</span>`;
      b.onclick = () => { closeMenus(); orcaLoad(o); };
      box.appendChild(b);
    }
    if (!ORCA.objects.length) box.insertAdjacentHTML("beforeend", `<div class="small" style="padding:6px 8px">No objects on the plate.</div>`);
  }
}
let rxTimer = 0;
function orcaLoad(o) {
  ORCA.cur = o; ORCA.rx = null; const req = `${ORCA.nonce}-m${++ORCA.req}`; ORCA.want = req;
  orcaSend({ cmd: "mesh", id: o.id, index: o.index, req }); busy(true); status(`Loading ${o.name} from the plate…`);
  clearTimeout(rxTimer);
  rxTimer = setTimeout(() => { if (ORCA.want === req) { ORCA.want = null; ORCA.rx = null; busy(false); alert(`${o.name} did not arrive from OrcaSlicer. Try again.`); } }, 60000);
}
let plateTimer = 0;
function orcaPlateChanged(m) {
  clearTimeout(plateTimer);
  plateTimer = setTimeout(() => orcaSend({ cmd: "objects" }), 300);
  const c = ORCA.cur, hit = c && ((m.id && m.id === String(c.id)) || (m.index >= 0 && m.index === c.index));
  if (S.G && hit && /Changed|Deleted|Transformed/.test(m.event || ""))
    status(`${S.name} changed on the plate since you opened it. Reopen it from the file menu to pick up the change.`);
}
function orcaMesh(m) { // chunks of the requested transfer, in any order
  if (!m.req || m.req !== ORCA.want) return; // a stale or superseded transfer
  if (!ORCA.rx || ORCA.rx.req !== m.req) ORCA.rx = { req: m.req, name: m.name, nV: m.nV, nF: m.nF, parts: new Array(m.of), got: 0 };
  const R = ORCA.rx;
  if (R.parts[m.part] == null) { R.parts[m.part] = m.data; R.got++; }
  if (R.got < m.of) return;
  ORCA.rx = null; ORCA.want = null; clearTimeout(rxTimer);
  try {
    const bin = atob(R.parts.join("")), b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    const pos = new Float32Array(b.buffer, 0, R.nV * 3), tri = new Uint32Array(b.buffer, R.nV * 12, R.nF * 3);
    loadRaw(R.name, { pos: Float32Array.from(pos), tri: Uint32Array.from(tri), source: { type: "orca", orca: { ...ORCA.cur } } });
    status(`Loaded ${R.name} from the plate`);
  } catch (e) { console.error(e); alert(e.message); }
  finally { busy(false); }
}
// Messages show in the page (the toast), not as a browser pop-up: the same in the browser and in OrcaSlicer, whose
// plugin webviews don't document alert().
window.alert = (t) => { const d = $("toast"); d.textContent = String(t); d.hidden = false; clearTimeout(d._t); d._t = setTimeout(() => (d.hidden = true), 8000); };
$("toast").onclick = () => ($("toast").hidden = true);
if (ORCA.on) {
  document.body.classList.add("inOrca");
  document.querySelectorAll("#fileMenu .meta").forEach((e) => e.remove()); // Ctrl+O is OrcaSlicer's Open project
  document.querySelectorAll(".orcaOnly").forEach((e) => (e.hidden = false));
  $("fileBtnLbl").textContent = "From plate";
  $("expMain").lastChild.textContent = "Send to Orca";
  $("expMain").title = $("sendAdd").title;
  $("expMain").onclick = () => { closeMenus(); later(() => ORCA.send("add")); };
  $("sendAdd").onclick = $("expMain").onclick;
  $("sendReplace").onclick = () => { closeMenus(); later(() => ORCA.send("replace_object")); };
  $("sendPlate").onclick = () => { closeMenus(); later(() => ORCA.send("replace_plate")); };
  $("sendFill").onclick = () => { closeMenus(); later(() => ORCA.send("fill_plate")); };
  $("expBtn").addEventListener("click", orcaSendMenu);
  $("expParts").lastChild.textContent = "Multi-part 3MF to Downloads";
  $("expParts").title = "Save a multi-part 3MF (each part keeps its filament slot) to Downloads, to import in OrcaSlicer with Ctrl+I";
  // Welcome screen: say where it runs, point at the web app instead of the plugin, and copy links
  // (the plugin page has no browser to open them in, and following one would replace the app).
  $("whereLocal").textContent = "in Orca";
  Object.assign($("linkOther"), { href: "https://splitmesh.carrigg.dev/", textContent: "Web app" });
  for (const a of document.querySelectorAll("#welcomeFoot a")) a.onclick = (e) => {
    e.preventDefault();
    const t = document.createElement("textarea"); t.value = a.href; document.body.append(t); t.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch {} t.remove();
    alert(ok ? `Link copied: ${a.href}. Paste it in your browser.` : `Open this in your browser: ${a.href}`);
  };
  window.orca.onMessage((m) => {
    if (!m || typeof m !== "object") return;
    if (m.cmd === "objects") {
      ORCA.objects = m.objects || []; orcaRenderObjects();
      if (Array.isArray(m.filament_colors) && m.filament_colors.length) { orcaFil = m.filament_colors; updateColors(); }
      if (m.auto && !S.G && ORCA.objects.length === 1) orcaLoad(ORCA.objects[0]);
    } else if (m.cmd === "mesh") orcaMesh(m);
    else if (m.cmd === "plate_changed") orcaPlateChanged(m);
    else if (m.cmd === "saved" || m.cmd === "save_error") {
      const P = ORCA.saves.get(m.id); if (!P) return; ORCA.saves.delete(m.id);
      m.cmd === "saved" ? P.res(m) : P.rej(new Error(m.message || "unknown error"));
    } else if (/^llm_/.test(m.cmd || "")) llmReply(m);
    else if (m.cmd === "error") { busy(false); ORCA.rx = null; ORCA.want = null; clearTimeout(rxTimer); status(m.message); alert(m.message); }
  });
  orcaSend({ cmd: "objects", auto: true });
}
window.app = { S, deleteGeometry, closeHoles, meshHoles, setAnchor, setGap, setTrim, trimResult, trimMeshes, setSlide, updateTrim, loopPlans, partLoops, fillCtx, fillMesh: () => fillMesh, setAutoStretch, solveAutoStretch, setStretch, stretchFrame, findHits, hits: () => hits, carryMat, ORCA, gizmo, gzProxy, setHold, holdersOf, setXfMatrix, xfEdited, reachPoints, setReach, reachOf, setFollow, leaderOf, followersOf, partMat, healField, healBase, partSoup, setGizmo, setGizmoJoint, jointFrame, xfMatrix, snapshot, buildParts3MF, exportParts3MF, loadRaw, scene, REPS, repMatrix, mergedSoup, partStats, localChecks, captureForNaming, runNaming, applyXf, ensureXf, undo, redo, deletePart, smoothBoundaries, smoothCut, snapCreases, encodeSession, segmentFromSeeds, autoSplit, splitShells, fillFrom, exportPainted3MF, exportSTLs, partMesh, paintCode, loadArrayBuffer, setTool, refreshUI, afterEdit, newPart, render, camera, controls, frame };
