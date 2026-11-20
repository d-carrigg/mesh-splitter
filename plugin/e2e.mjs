// End-to-end check of the built plugin page with the real plugin.py Bridge behind a fake OrcaSlicer host.
//   node e2e.mjs MESH.stl OUT_DIR [--shot shot.png]
// Opens build/page.html (python build.py --page-out build/page.html), injects window.orca the way
// OrcaSlicer's WebHosting.cpp does, pipes page <-> fake_host.py, waits for the plate object to load and
// auto split, presses "Send to Orca", and prints the saved path.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const here = path.dirname(fileURLToPath(import.meta.url));
const [mesh, outDir] = process.argv.slice(2);
const shot = process.argv.includes("--shot") ? process.argv[process.argv.indexOf("--shot") + 1] : null;
const py = process.env.PYTHON || "python";
const host = spawn(py, [path.join(here, "fake_host.py"), mesh, "--out", outDir], { stdio: ["pipe", "pipe", "inherit"] });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => { errors.push("dialog: " + d.message()); d.dismiss(); });
await page.exposeFunction("__toHost", (json) => host.stdin.write(json + "\n"));
// Same surface as ORCA_BRIDGE_JS in src/slic3r/GUI/Widgets/WebHosting.cpp (v2.5.1).
await page.addInitScript(() => {
  const handlers = [];
  window.orca = {
    postMessage: (d) => window.__toHost(JSON.stringify(d)),
    submit() {}, close() {},
    onMessage: (cb) => { if (typeof cb === "function") handlers.push(cb); },
  };
  window.__orcaDispatch = (p) => { for (const h of handlers) { try { h(p ? p.data : null); } catch (e) {} } };
  // Element defaults OrcaSlicer injects into plugin pages (WebViewHostDialog::element_defaults_user_script, teal accent).
  document.addEventListener("DOMContentLoaded", () => {
    const st = document.createElement("style");
    st.textContent = ":root{--orca-bg:#2d2d31;--orca-fg:#efefef;--orca-accent:#009688;--orca-accent-fg:#fff;--orca-border:#4a4a51}" +
      "html,body{background:var(--orca-bg);color:var(--orca-fg);font-size:13px}button{color:var(--orca-accent-fg);background:var(--orca-accent);" +
      "border:1px solid var(--orca-accent);border-radius:4px;padding:5px 14px}button:hover{filter:brightness(1.1)}";
    document.head.appendChild(st);
  });
});
let saved = null;
createInterface({ input: host.stdout }).on("line", async (line) => {
  const msg = JSON.parse(line);
  if (msg.cmd === "saved") saved = msg.path;
  if (msg.cmd === "save_error" || msg.cmd === "error") errors.push(msg.message);
  await page.evaluate((m) => window.__orcaDispatch({ data: m }), msg).catch((e) => errors.push(e.message));
});

await page.goto("file://" + path.join(here, "build", "page.html"));
await page.waitForFunction(() => window.app?.S?.G && window.app.S.parts.length > 1, null, { timeout: 120000 });
const info = await page.evaluate(() => ({ faces: app.S.nF, parts: app.S.parts.length, name: app.S.name,
  file: document.getElementById("fileInfo").textContent, send: document.getElementById("expMain").textContent.trim() }));
console.log("loaded:", JSON.stringify(info));
// Transform gizmo: drag the move handle's center, expect a translation and one undo step.
await page.evaluate(() => { app.S.active = 1; app.refreshUI(); });
await page.waitForTimeout(100);
const g = await page.evaluate(() => { const v = app.gzProxy.position.clone().project(app.camera), r = document.querySelector("#view canvas").getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, on: !!app.gizmo.object, undo: app.S.hist.past.length }; });
await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.move(g.x + 80, g.y + 10, { steps: 10 }); await page.mouse.up();
const moved = await page.evaluate(() => ({ t: app.S.parts[1].xf?.t, undo: app.S.hist.past.length }));
console.log("gizmo:", JSON.stringify({ attached: g.on, ...moved }));
if (!g.on || !moved.t || moved.t.every((v) => v === 0) || moved.undo !== g.undo + 1) errors.push("gizmo drag did not move the part");
await page.keyboard.press("Control+z");
// Rotate on joint: cut a tilted cap off the body, spin it on its joint, expect the joint's center and normal to stay put.
const jt = await page.evaluate(() => {
  const { S } = app, n = [0.5, 0, 0.866];
  const body = S.labels[0], cap = S.parts.push(app.newPart()) - 1, ctr = [0, 0, 0], fc = (f) => [0, 1, 2].map((k) => (S.pos[3*S.tri[3*f]+k] + S.pos[3*S.tri[3*f+1]+k] + S.pos[3*S.tri[3*f+2]+k]) / 3);
  let m = 0; for (let f = 0; f < S.nF; f++) if (S.labels[f] === body) { fc(f).forEach((v, k) => (ctr[k] += v)); m++; }
  for (let f = 0; f < S.nF; f++) if (S.labels[f] === body && fc(f).reduce((d, v, k) => d + (v - ctr[k] / m) * n[k], 0) > 12) S.labels[f] = cap;
  S.active = cap; app.afterEdit(); app.setGizmo("rotate"); app.setGizmoJoint(true);
  const jf0 = app.jointFrame(cap); if (!jf0) return { err: "no joint frame" };
  const { gizmo, gzProxy } = app, THREE = gzProxy.quaternion.constructor;
  const before = S.hist.past.length;
  gizmo.dispatchEvent({ type: "dragging-changed", value: true });
  gzProxy.quaternion.multiply(new THREE().setFromAxisAngle(gzProxy.up.clone().set(0, 1, 0), Math.PI / 3)); // 60° on the ring's axis
  gizmo.dispatchEvent({ type: "objectChange" });
  gizmo.dispatchEvent({ type: "dragging-changed", value: false });
  const jf1 = app.jointFrame(cap), x = S.parts[cap].xf;
  return { r: x.r, t: x.t, dJ: jf1.J.distanceTo(jf0.J), dot: jf1.n.dot(jf0.n), undo: S.hist.past.length - before, ring: { x: gizmo.showX, y: gizmo.showY, z: gizmo.showZ } };
});
console.log("joint:", JSON.stringify(jt));
if (jt.err || jt.dJ > 1e-3 || jt.dot < 0.9999 || jt.r.every((v) => v === 0) || jt.undo !== 1 || jt.ring.x || !jt.ring.y) errors.push("rotate on joint moved the joint: " + JSON.stringify(jt));
if (shot) await page.screenshot({ path: shot.replace(/\.png$/, "_joint.png") });
// Move with: the head follows the cap; spinning the cap on its joint carries the head rigidly, and undo puts it back.
const mw = await page.evaluate(() => {
  const { S, gizmo, gzProxy } = app, cap = S.active, head = S.parts.findIndex((_, j) => j > 0 && j !== cap && j !== S.labels[0]);
  const before = S.hist.past.length;
  app.setFollow([head], cap);
  const rel0 = app.partMat(cap).invert().multiply(app.partMat(head)).toArray(), Q = gzProxy.quaternion.constructor;
  gizmo.dispatchEvent({ type: "dragging-changed", value: true });
  gzProxy.quaternion.multiply(new Q().setFromAxisAngle(gzProxy.up.clone().set(0, 1, 0), Math.PI / 6));
  gizmo.dispatchEvent({ type: "objectChange" });
  gizmo.dispatchEvent({ type: "dragging-changed", value: false });
  const rel1 = app.partMat(cap).invert().multiply(app.partMat(head)).toArray();
  const out = { head, leader: app.leaderOf(head), moved: !!app.xfMatrix(S.parts[head]), relErr: Math.max(...rel0.map((v, k) => Math.abs(v - rel1[k]))), undo: S.hist.past.length - before };
  app.undo(); app.undo();
  out.after = { follow: !!S.parts[head].follow, moved: !!app.xfMatrix(S.parts[head]) };
  return out;
});
console.log("move with:", JSON.stringify(mw));
// Reach: the head reaches for the cap; after the cap moves, the head's end point lands where the cap carried it.
const rc = await page.evaluate(() => {
  const { S } = app, cap = S.active, head = S.parts.findIndex((_, j) => j > 0 && j !== cap && j !== S.labels[0]), before = S.hist.past.length;
  app.setReach(head, cap);
  S.active = cap; app.refreshUI();
  const t0 = document.getElementById("xfT0"); t0.value = +t0.value + 4; t0.dispatchEvent(new Event("input", { bubbles: true })); // panel edit carries/re-solves
  const E0 = app.gzProxy.position.clone().set(...S.parts[head].reach.e);
  const a = E0.clone().applyMatrix4(app.partMat(head)), b = E0.clone().applyMatrix4(app.partMat(cap));
  const out = { reach: app.reachOf(head), err: a.distanceTo(b), moved: !!app.xfMatrix(S.parts[head]) };
  app.undo(); out.after = !!S.parts[head].reach;
  return out;
});
console.log("reach:", JSON.stringify(rc));
// Hold: the head is held by the cap and the body; after the cap moves, the head's grip midpoint follows the grips.
const hd = await page.evaluate(() => {
  const { S } = app, cap = S.active, body = S.labels[0], head = S.parts.findIndex((_, j) => j > 0 && j !== cap && j !== body);
  app.setHold(head, cap, body);
  const h = S.parts[head].hold, V = app.gzProxy.position.constructor;
  S.active = cap; app.refreshUI();
  const t0 = document.getElementById("xfT2"); t0.value = +t0.value + 5; t0.dispatchEvent(new Event("input", { bubbles: true }));
  const A0 = new V(...h.ga), B0 = new V(...h.gb), m0 = A0.clone().add(B0).multiplyScalar(0.5);
  const m1 = A0.clone().applyMatrix4(app.partMat(cap)).add(B0.clone().applyMatrix4(app.partMat(body))).multiplyScalar(0.5);
  const ga1 = A0.clone().applyMatrix4(app.partMat(head)), gb1 = B0.clone().applyMatrix4(app.partMat(head));
  const out = { held: app.holdersOf(head), err: m0.applyMatrix4(app.partMat(head)).distanceTo(m1),
    gripErr: Math.max(ga1.distanceTo(A0.clone().applyMatrix4(app.partMat(cap))), gb1.distanceTo(B0.clone().applyMatrix4(app.partMat(body)))) };
  app.undo(); out.after = !!S.parts[head].hold;
  return out;
});
console.log("hold:", JSON.stringify(hd));
if (!hd.held || hd.err > 1e-3 || hd.gripErr > 1e-3 || hd.after) errors.push("hold failed: " + JSON.stringify(hd));
// Stretch: the cap (holding the head with the body) is stretched 130% from its joint: the joint stays put, the held
// part's grips follow the stretched cap, and undo removes it.
const st = await page.evaluate(() => {
  const { S } = app, cap = S.active, body = S.labels[0], head = S.parts.findIndex((_, j) => j > 0 && j !== cap && j !== body), V = app.gzProxy.position.constructor;
  app.setHold(head, cap, body);
  app.setStretch([cap], 130);
  const x = S.parts[cap].xf, P = new V(...x.st.p), h = S.parts[head].hold;
  const A0 = new V(...h.ga), B0 = new V(...h.gb), m0 = A0.clone().add(B0).multiplyScalar(0.5);
  const m1 = A0.clone().applyMatrix4(app.partMat(cap)).add(B0.clone().applyMatrix4(app.partMat(body))).multiplyScalar(0.5);
  const out = { k: x.st.k, pivotErr: P.clone().applyMatrix4(app.partMat(cap)).distanceTo(P), holdErr: m0.applyMatrix4(app.partMat(head)).distanceTo(m1), hits: Array.isArray(app.findHits()) };
  app.undo(); out.after = !!S.parts[cap].xf?.st; app.undo();
  return out;
});
console.log("stretch:", JSON.stringify(st));
// Auto stretch: turn it on for the cap (still holding the head), solve, expect a solved factor and nothing within the gap.
const as = await page.evaluate(() => {
  const { S } = app, cap = S.active, body = S.labels[0], head = S.parts.findIndex((_, j) => j > 0 && j !== cap && j !== body);
  app.setHold(head, cap, body);
  app.setAutoStretch([cap], true, 1); app.solveAutoStretch();
  const st = S.parts[cap].xf.st, out = { auto: !!st.auto, gap: st.gap, k: st.k, near: app.findHits({ only: new Set([head]), gap: 1 }).length };
  app.undo(); out.after = !!S.parts[cap].xf?.st?.auto; app.undo();
  return out;
});
console.log("auto stretch:", JSON.stringify(as));
if (!as.auto || as.gap !== 1 || !(as.k >= 1) || as.after) errors.push("auto stretch failed: " + JSON.stringify(as));
if (st.k !== 1.3 || st.pivotErr > 1e-3 || st.holdErr > 1e-3 || !st.hits || st.after) errors.push("stretch failed: " + JSON.stringify(st));
if (rc.reach <= 0 || !rc.moved || rc.err > 1e-3 || rc.after) errors.push("reach failed: " + JSON.stringify(rc));
if (mw.leader <= 0 || !mw.moved || mw.relErr > 5e-3 || mw.undo !== 2 || mw.after.follow || mw.after.moved) errors.push("move with failed: " + JSON.stringify(mw));
// Heal joint: shift the cap 3 mm sideways, heal it, expect its cut edge back on the body's rim and a closed part.
const hl = await page.evaluate(() => {
  const { S } = app, i = S.active, x = app.ensureXf(i); x.t = [x.t[0] + 3, x.t[1], x.t[2]]; app.applyXf();
  document.getElementById("healOn").click();
  const B = app.healBase(i), h = app.healField(i), M = app.xfMatrix(S.parts[i]);
  let mx = 0; B.pts.forEach((q, k) => { const p = q.clone().applyMatrix4(M).add(h.d[k]); let bd = Infinity; B.pts.forEach((r, j) => { const r2 = B.pts[(j+1) % B.pts.length], e = r2.clone().sub(r), t = Math.min(1, Math.max(0, p.clone().sub(r).dot(e) / e.lengthSq())); bd = Math.min(bd, r.clone().addScaledVector(e, t).distanceTo(p)); }); mx = Math.max(mx, bd); });
  const v = app.partSoup(i), edges = new Map(), key = (o) => [v[o], v[o+1], v[o+2]].map((t) => t.toFixed(4)).join(",");
  for (let o = 0; o < v.length; o += 9) for (let e = 0; e < 3; e++) { const a = key(o + 3*e), b = key(o + 3*((e+1)%3)), k2 = a < b ? a + "|" + b : b + "|" + a; edges.set(k2, (edges.get(k2) || 0) + 1); }
  return { heal: S.parts[i].heal, maxGap: +mx.toFixed(3), open: [...edges.values()].filter((c) => c !== 2).length };
});
console.log("heal:", JSON.stringify(hl));
if (!hl.heal || hl.maxGap > 0.05 || hl.open) errors.push("heal joint failed: " + JSON.stringify(hl));
await page.keyboard.press("Control+z");
await page.keyboard.press("Control+z");
await page.evaluate(() => app.setGizmoJoint(false));
if (shot) await page.screenshot({ path: shot });
await page.click("#expMain");
const t0 = Date.now();
while (!saved && !errors.length && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 100));
console.log("status:", await page.textContent("#status"));
await browser.close();
host.stdin.end();
if (errors.length || !saved) { console.error("FAILED:", errors.join(" | ") || "nothing saved"); process.exit(1); }
console.log("saved:", saved);
