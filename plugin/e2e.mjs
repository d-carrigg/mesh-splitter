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
// Transform gizmo: drag the move handle's centre, expect a translation and one undo step.
await page.evaluate(() => { app.S.active = 1; app.refreshUI(); });
await page.waitForTimeout(100);
const g = await page.evaluate(() => { const v = app.gzProxy.position.clone().project(app.camera), r = document.querySelector("#view canvas").getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, on: !!app.gizmo.object, undo: app.S.hist.past.length }; });
await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.move(g.x + 80, g.y + 10, { steps: 10 }); await page.mouse.up();
const moved = await page.evaluate(() => ({ t: app.S.parts[1].xf?.t, undo: app.S.hist.past.length }));
console.log("gizmo:", JSON.stringify({ attached: g.on, ...moved }));
if (!g.on || !moved.t || moved.t.every((v) => v === 0) || moved.undo !== g.undo + 1) errors.push("gizmo drag did not move the part");
await page.keyboard.press("Control+z");
if (shot) await page.screenshot({ path: shot });
await page.click("#expMain");
const t0 = Date.now();
while (!saved && !errors.length && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 100));
console.log("status:", await page.textContent("#status"));
await browser.close();
host.stdin.end();
if (errors.length || !saved) { console.error("FAILED:", errors.join(" | ") || "nothing saved"); process.exit(1); }
console.log("saved:", saved);
