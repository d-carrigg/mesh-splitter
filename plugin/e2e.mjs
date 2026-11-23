// End-to-end check of the built plugin page with the real plugin.py Bridge behind a fake OrcaSlicer host.
//   node e2e.mjs MESH.stl OUT_DIR [--shot shot.png]
// Opens build/page.html (python build.py --page-out build/page.html), injects window.orca the way
// OrcaSlicer's WebHosting.cpp does, pipes page <-> fake_host.py, waits for the plate object to load and
// auto split, sends it to Orca (Replace), saves the multi-part 3MF, and prints the saved path.
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
let saved = null, handoff = null;
createInterface({ input: host.stdout }).on("line", async (line) => {
  const msg = JSON.parse(line);
  if (msg.cmd === "__handoff") { handoff = msg.files; return; }
  if (msg.cmd === "saved") saved = msg;
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
// Open / Fill / Anchor: lift the cap 4 mm off the body. Open (default) leaves the gap with flat caps; Fill patches the hole on both sides (both parts stay closed);
// Anchor sweeps new material from the body's rim to the cap instead (closed, more volume, no patch on the body).
const fa = await page.evaluate(() => {
  const { S } = app, i = S.active, x = app.ensureXf(i); x.t = [x.t[0], x.t[1], x.t[2] + 4]; app.applyXf();
  const solid = (v) => { const E = new Map(), k = (o) => [v[o], v[o+1], v[o+2]].map((t) => t.toFixed(4)).join(","); let vol = 0;
    for (let o = 0; o < v.length; o += 9) { for (let e = 0; e < 3; e++) { const a = k(o + 3*e), b = k(o + 3*((e+1)%3)), kk = a < b ? a + "|" + b : b + "|" + a; E.set(kk, (E.get(kk) || 0) + 1); }
      vol += (v[o]*(v[o+4]*v[o+8]-v[o+5]*v[o+7]) - v[o+1]*(v[o+3]*v[o+8]-v[o+5]*v[o+6]) + v[o+2]*(v[o+3]*v[o+7]-v[o+4]*v[o+6])) / 6; }
    return { open: [...E.values()].filter((c) => c !== 2).length, vol: +vol.toFixed(1) }; };
  const ctx = app.fillCtx(), nb = app.loopPlans(app.partLoops(i, ctx), ctx).find((p) => p.nb > 0)?.nb;
  const kinds = () => { const c = app.fillCtx(); return app.loopPlans(app.partLoops(i, c), c).map((p) => p.kind).join(","); };
  const open = { kinds: kinds(), shown: !!app.fillMesh(), me: solid(app.partSoup(i)), nb: solid(app.partSoup(nb)) }; // Open, the default
  app.setGap([i], "fill");
  const fill = { kinds: kinds(), shown: !!app.fillMesh(), me: solid(app.partSoup(i)), nb: solid(app.partSoup(nb)) };
  app.setGap([i], "anchor");
  const anchor = { kinds: kinds(), me: solid(app.partSoup(i)), nb: solid(app.partSoup(nb)), saved: S.parts[i].anchor };
  app.undo(); app.undo(); x.t = [x.t[0], x.t[1], x.t[2] - 4]; app.applyXf();
  return { open, fill, anchor, after: !!S.parts[i].anchor || !!S.parts[i].fill };
});
console.log("fill/anchor:", JSON.stringify(fa));
if (fa.open.kinds.includes("patch") || fa.open.shown || fa.open.me.open || fa.open.nb.open
  || !fa.fill.kinds.includes("patch") || !fa.fill.shown || fa.fill.me.open || fa.fill.nb.open || !fa.anchor.kinds.includes("bridge") || fa.anchor.me.open
  || fa.anchor.nb.open || !(fa.anchor.me.vol > fa.fill.me.vol + 1) || !fa.anchor.saved || fa.after) errors.push("fill/anchor failed: " + JSON.stringify(fa));
// Connectors: a plug on one of the cap's seams, then a dowel there, then every seam, in the multi-part 3MF. Every part
// stays closed (each edge on exactly two triangles). Making the plug 2 mm deep instead (same cap) takes the peg's
// volume for the difference off its part and gives the hole's back to the other; a dowel adds its own part and a hole
// to each side. The view's files keep no connector.
const cn = await page.evaluate(() => {
  const { S } = app, i = S.active, s = app.seams().find((q) => q.a === i || q.b === i);
  const solid = (P) => { const E = new Map(); let vol = 0; const v = (j) => [P.pos[3*j], P.pos[3*j+1], P.pos[3*j+2]];
    for (let t = 0; t < P.tri.length; t += 3) { const [a, b, c] = [0, 1, 2].map((e) => P.tri[t+e]);
      for (const [x, y] of [[a, b], [b, c], [c, a]]) { const kk = x < y ? x + "|" + y : y + "|" + x; E.set(kk, (E.get(kk) || 0) + 1); }
      const [A, B, C] = [v(a), v(b), v(c)]; vol += (A[0]*(B[1]*C[2]-B[2]*C[1]) - A[1]*(B[0]*C[2]-B[2]*C[0]) + A[2]*(B[0]*C[1]-B[1]*C[0])) / 6; }
    return { open: [...E.values()].filter((c) => c !== 2).length, vol }; };
  const byName = () => Object.fromEntries(app.buildParts3MF().parts.map((p) => [p.name, solid(p)]));
  if (!s) return { err: "no seam on the cap" };
  const base = byName(), merged = app.mergedSoup().v.length;
  app.connectSeams([s]);
  const e = app.connState().bySeam.get(s);
  if (e?.state !== "ok") return { err: "no plug fits", e: e && { state: e.state, why: e.why } };
  const peg = S.parts[e.pl.plugOn].name, hole = S.parts[e.pl.holeIn].name, r = e.d / 2, clr = e.c.clr, plug = byName();
  app.editConns([e.k], (c) => { c.depth = 2; }, "shallow", true);
  const shallow = byName(); app.undo();
  app.editConns([e.k], (c) => { c.peg = null; c.shape = "hex"; }, "dowel");
  const d = app.connState().bySeam.get(s), dowel = byName(), A = S.parts[s.a].name, B = S.parts[s.b].name;
  const mergedSame = merged === app.mergedSoup().v.length;
  app.undo(); app.undo();
  app.connectSeams(app.seams());
  const st = app.connState(), all = st.list.filter((q) => q.state === "ok").length, allOpen = Object.values(byName()).reduce((t, q) => t + q.open, 0);
  app.undo();
  return { d: e.d, depth: e.depth, dowel: d.state, pegVol: plug[peg].vol - shallow[peg].vol, pegWant: Math.PI * r * r * (e.depth - 2),
    holeVol: shallow[hole].vol - plug[hole].vol, holeWant: Math.PI * (r + clr) ** 2 * (e.depth - 2),
    open: [...Object.values(plug), ...Object.values(shallow), ...Object.values(dowel)].reduce((t, q) => t + q.open, 0), dowelPart: !!dowel[`${A} – ${B} dowel`],
    dowelHoles: base[A].vol - dowel[A].vol > 0 && base[B].vol - dowel[B].vol > 0, mergedSame, all, allOpen, after: S.conns.length };
});
console.log("connectors:", JSON.stringify(cn));
const near = (a, b) => Math.abs(a - b) < 0.02 * b;
if (cn.err || cn.dowel !== "ok" || cn.open || !near(cn.pegVol, cn.pegWant) || !near(cn.holeVol, cn.holeWant) || !cn.dowelPart || !cn.dowelHoles || !cn.mergedSame || !cn.all || cn.allOpen || cn.after)
  errors.push("connectors failed: " + JSON.stringify(cn));
await page.evaluate(() => app.setGizmoJoint(false));
if (shot) await page.screenshot({ path: shot });
// AI part naming from inside OrcaSlicer: set up a local OpenAI-compatible server (no key), as with LM Studio,
// name the parts through the plugin, and apply the names.
const mock = spawn(py, [path.join(here, "..", "server", "mock_llm_server.py"), "--port", "18765", "--think", "2"], { stdio: ["ignore", "pipe", "ignore"] });
process.on("exit", () => mock.kill());
await new Promise((r) => mock.stdout.once("data", r));
// Not connected yet: opening the panel shows the Connect step.
await page.evaluate(() => { document.getElementById("xfDone")?.click(); document.getElementById("aiToggle").click(); });
await page.waitForSelector("#aiSet:not([hidden])", { timeout: 5000 });
await page.selectOption("#aiProv", "custom");
await page.fill("#aiUrl", "http://127.0.0.1:18765/v1"); await page.click("#aiSave");
await page.waitForFunction(() => document.getElementById("aiConn").classList.contains("ok"), null, { timeout: 10000 })
  .catch(async () => errors.push("AI connect failed: " + await page.textContent("#aiConn")));
await page.waitForSelector("#aiMain:not([hidden])", { timeout: 5000 });
if (!(await page.textContent("#aiState")).includes("127.0.0.1:18765")) errors.push("AI state: " + await page.textContent("#aiState"));
if (!await page.evaluate(() => [...document.querySelectorAll("#aiModels option")].some((o) => o.value === "mock-vision-1"))) errors.push("AI model list not filled");
// Progress shows the stage and elapsed time; Cancel stops it without an error.
await page.click("#aiBtn");
await page.waitForFunction(() => /thinking/.test(document.getElementById("aiStage").textContent), null, { timeout: 20000 })
  .catch(async () => errors.push("AI progress never showed thinking: " + await page.textContent("#aiStage")));
console.log("ai progress:", await page.textContent("#aiStage"), await page.textContent("#aiDetail"), await page.textContent("#aiTime"));
await page.click("#aiStop");
await page.waitForSelector("#aiProg[hidden]", { state: "attached", timeout: 5000 }).catch(() => errors.push("AI cancel did not stop"));
if (await page.$("#aiOut .nm")) errors.push("AI names shown after cancel");
await page.click("#aiBtn");
const aiErr = () => [...document.querySelectorAll("#aiOut .iss.high")].find((d) => !d.querySelector(".small"))?.textContent; // check issues carry "· check"
await page.waitForFunction((f) => document.querySelector("#aiOut .nm") || eval(f)(), aiErr.toString(), { timeout: 60000 });
const ai = await page.evaluate((f) => ({ err: eval(f)(), rows: document.querySelectorAll("#aiOut .nm").length, parts: app.S.parts.length - 1 }), aiErr.toString());
if (ai.err || ai.rows !== ai.parts) errors.push("AI naming failed: " + JSON.stringify(ai));
else {
  await page.click("#aiOut button:has-text('Apply names')");
  const names = await page.evaluate(() => app.S.parts.slice(1).map((p) => p.name));
  if (!names.every((n, i) => n === `mock part ${i + 1}`)) errors.push("AI names not applied: " + names.join(", "));
  console.log("ai naming:", names.join(", "));
}
mock.kill();
// The menu has only the file exports: Send to Orca is the main button.
if (await page.isVisible("#aiClose")) await page.click("#aiClose");
await page.click("#expBtn");
const menu = await page.evaluate(() => [...document.querySelectorAll("#expMenu button")].filter((b) => !b.hidden).map((b) => b.id));
console.log("export menu:", JSON.stringify(menu));
if (menu.join() !== "expParts,exp3mf,expStl,expMerged") errors.push("export menu: " + JSON.stringify(menu));
if (shot) { await page.waitForTimeout(400); await page.screenshot({ path: shot.replace(/\.png$/, "_send.png") }); }
await page.click("#expBtn");
// Print as starts at One part for a plain one-part object: the edited model goes back as one part on the
// original's filament, and the filament slots are hidden.
const pa = await page.evaluate(() => ({ mode: app.S.printAs, filHidden: getComputedStyle(document.querySelector("#partsBody .fcol")).display === "none" }));
console.log("print as:", JSON.stringify(pa));
if (pa.mode !== "one" || !pa.filHidden) errors.push("Print as should start at One part with filament slots hidden: " + JSON.stringify(pa));
await page.click("#expMain"); // Send to Orca: the split goes into the project next to the original
const wait = async (ok) => { const t0 = Date.now(); while (!ok() && !errors.length && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 100)); };
await wait(() => saved && handoff);
const sent = saved; saved = null;
console.log("status:", await page.textContent("#status"));
if (!errors.length && !(sent?.ask === "Open as project" && handoff?.length === 1 && handoff[0] === sent.path && sent.removed === 0 && sent.copies === 1 && sent.parts === 1 && sent.filaments_added === 0))
  errors.push("Send to Orca did not hand the project to OrcaSlicer: " + JSON.stringify({ sent, handoff }));
// Painted: one part, painted with the parts' filaments; the slots it uses are added to the project
handoff = null;
await page.click('#printAs button[data-mode="paint"]');
await page.click("#expMain");
await wait(() => saved && handoff);
const painted = saved; saved = null;
console.log("painted:", JSON.stringify({ parts: painted?.parts, added: painted?.filaments_added }));
if (!errors.length && !(painted?.parts === 1 && painted.filaments_added > 0)) errors.push("Painted send: " + JSON.stringify(painted));
// The page's own multi-part 3MF still saves to Downloads (CI checks it with verify_3mf.py)
await page.click("#expBtn"); await page.click("#expParts");
await wait(() => saved);
await browser.close();
host.stdin.end();
if (errors.length || !saved) { console.error("FAILED:", errors.join(" | ") || "nothing saved"); process.exit(1); }
console.log("sent:", sent.path);
console.log("saved:", saved.path);
