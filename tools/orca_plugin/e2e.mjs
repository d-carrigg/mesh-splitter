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
  file: document.getElementById("fileInfo").textContent, sendVisible: !document.getElementById("orcaSend").hidden }));
console.log("loaded:", JSON.stringify(info));
if (shot) await page.screenshot({ path: shot });
await page.click("#orcaSend");
const t0 = Date.now();
while (!saved && !errors.length && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 100));
console.log("status:", await page.textContent("#status"));
await browser.close();
host.stdin.end();
if (errors.length || !saved) { console.error("FAILED:", errors.join(" | ") || "nothing saved"); process.exit(1); }
console.log("saved:", saved);
