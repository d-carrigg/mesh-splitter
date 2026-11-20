// Record the README / OrcaCloud demo GIF (and the feature docs' GIFs and screenshots) by driving the browser app headless.
//
//   node docs/demo/record.mjs [config.json ...] [--out docs/demo.gif] [--assets DIR] [--keep-frames]
//
// Several configs run one after another (e.g. docs/features/demo/*.json). A config with "out": null records
// no GIF and only writes its "shot" / "compare" PNGs (into "shots", default docs/features/img).
// "orca": true fakes the OrcaSlicer plugin host, so the page shows its plugin UI (Send to Orca).
//
// Needs Playwright (with Chromium), ffmpeg, and plugin/node_modules (cd plugin && npm ci), which stands in
// for the CDN imports. The page is served from the repo through Playwright routes, so no server runs.
// Frames are captured step by step at a fixed frame rate, so the GIF's timing doesn't depend on how fast
// the machine renders. Steps, timing, camera and size all come from the config (demo.config.json).
// The demo meshes aren't in the repo: prep_curling.py makes them. --keep-frames leaves the PNGs in build/frames.
import { mkdirSync, readFileSync, rmSync, existsSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const VALUED = ["--out", "--assets"];
const cfgArgs = args.filter((a, i) => !a.startsWith("--") && !VALUED.includes(args[i - 1]));
if (cfgArgs.length > 1) { // one run per config, each in its own process
  const rest = args.filter((a) => !cfgArgs.includes(a));
  for (const c of cfgArgs) {
    console.log(`== ${c}`);
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), c, ...rest], { stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status || 1);
  }
  process.exit(0);
}
const cfgPath = path.resolve(cfgArgs[0] || path.join(here, "demo.config.json"));
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const gifOn = cfg.out !== null; // "out": null = screenshots only
const out = path.resolve(root, opt("--out", cfg.out || "docs/demo.gif"));
const shotsDir = path.resolve(root, cfg.shots || "docs/features/img");
// Model files: absolute, or relative to cfg.assets (itself relative to the repo root). --assets overrides it.
const assets = path.resolve(root, opt("--assets", cfg.assets || "."));
const asset = (f) => path.resolve(assets, f);
const fps = cfg.fps ?? 12;
const framesDir = path.join(here, "build", "frames");
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

// ---------------------------------------------------------------- serving
const ORIGIN = "http://demo.local";
const nm = path.join(root, "plugin", "node_modules");
if (!existsSync(path.join(nm, "three"))) throw new Error("plugin/node_modules missing: run `npm ci` in plugin/");
const TYPES = { js: "text/javascript", mjs: "text/javascript", html: "text/html", css: "text/css", json: "application/json", stl: "model/stl", "3mf": "model/3mf", png: "image/png", svg: "image/svg+xml" };
const serve = (route, file) => {
  if (!existsSync(file) || !statSync(file).isFile()) return route.fulfill({ status: 404, body: "not found" });
  return route.fulfill({ status: 200, body: readFileSync(file), contentType: TYPES[file.split(".").pop().toLowerCase()] || "application/octet-stream" });
};

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const vp = cfg.viewport || { width: 1200, height: 720 };
const page = await browser.newPage({ viewport: vp, deviceScaleFactor: cfg.deviceScaleFactor ?? 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.text().startsWith("demo:") && console.log(m.text())); // console.log("demo: ...") from an eval step
page.on("dialog", (d) => { errors.push("dialog: " + d.message()); d.dismiss(); });
await page.route("https://cdn.jsdelivr.net/npm/**", (r) => {
  const m = new URL(r.request().url()).pathname.match(/^\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.*)$/);
  return m ? serve(r, path.join(nm, m[1], m[2])) : r.fulfill({ status: 404 });
});
await page.route(ORIGIN + "/**", (r) => {
  const p = decodeURIComponent(new URL(r.request().url()).pathname);
  if (p === "/api/llm/status") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cfg.llmStatus || { configured: false, source: null, model: "" }) });
  return serve(r, path.join(root, p.endsWith("/") ? p + "index.html" : p));
});
// "orca": true stands in for the OrcaSlicer plugin host, so the page shows its plugin UI. It lists the demo
// model as the one plate object (the model itself is opened by the load step) and answers saves with a path.
if (cfg.orca) await page.addInitScript((name) => {
  let rx = null;
  const reply = (m) => setTimeout(() => rx?.(m), 0);
  window.orca = {
    onMessage: (f) => (rx = f),
    postMessage(m) {
      if (m.cmd === "objects") reply({ cmd: "objects", objects: [{ id: "1", index: 0, name, faces: +(document.getElementById("fileInfo")?.textContent.match(/[\d,]+(?= faces)/)?.[0] || "0").replace(/,/g, ""), parts: 1 }] });
      else if (m.cmd === "save" && m.part === m.of - 1) reply({ cmd: "saved", id: m.id, path: `C:\\Users\\you\\Downloads\\${m.name}` });
    },
  };
}, path.parse(cfg.model).name);
await page.addInitScript((theme) => {
  try { localStorage.clear(); for (const [k, v] of Object.entries(theme || {})) localStorage.setItem(k, v); } catch {}
}, cfg.localStorage || {});

// ---------------------------------------------------------------- frame capture
let n = 0;
const snap = async () => gifOn && writeFile(path.join(framesDir, `f${String(n++).padStart(5, "0")}.png`), await page.screenshot());
const hold = async (s) => { for (let i = 0, k = Math.max(1, Math.round(s * fps)); i < k; i++) await snap(); };
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const idle = () => page.waitForFunction(() => getComputedStyle(document.getElementById("busy")).display === "none", null, { timeout: 300000 });

// Fake cursor so viewers can follow the clicks (headless Chromium draws none).
await page.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.id = "__cursor";
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 10.5-6.6 1.3 3.9 7.4-3 1.6-3.9-7.5L4 20z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg><i></i>';
    c.style.cssText = "position:fixed;left:-50px;top:-50px;z-index:99999;pointer-events:none;filter:drop-shadow(0 1px 2px #0008)";
    const ring = c.querySelector("i");
    ring.style.cssText = "position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;border:3px solid #4fc3f7;opacity:0;transform:scale(.4)";
    document.body.appendChild(c);
    const cap = document.createElement("div");
    cap.id = "__caption";
    cap.style.cssText = "position:fixed;left:50%;bottom:44px;transform:translateX(-50%);z-index:99998;pointer-events:none;padding:10px 22px;" +
      "border-radius:10px;background:#000b;color:#fff;font:600 24px system-ui,sans-serif;white-space:nowrap;transition:opacity .2s;opacity:0";
    document.body.appendChild(cap);
    window.__caption = (t, at) => { cap.textContent = t || ""; cap.style.opacity = t ? "1" : "0"; if (at) Object.assign(cap.style, at); };
    window.__cur = {
      at(x, y) { c.style.left = x + "px"; c.style.top = y + "px"; },
      pulse(t) { ring.style.opacity = String(Math.max(0, 1 - t)); ring.style.transform = `scale(${0.4 + t})`; },
    };
  });
});
let cur = { x: vp.width * 0.6, y: vp.height * 0.6 };
const cursorTo = async (x, y, s, drag = false) => {
  const k = Math.max(1, Math.round(s * fps)), a = { ...cur };
  for (let i = 1; i <= k; i++) {
    const t = ease(i / k), px = a.x + (x - a.x) * t, py = a.y + (y - a.y) * t;
    await page.mouse.move(px, py);
    await page.evaluate(([px, py]) => window.__cur.at(px, py), [px, py]);
    await snap();
  }
  cur = { x, y };
  if (!drag) await page.evaluate(([x, y]) => window.__cur.at(x, y), [x, y]);
};
const pulse = async () => { for (const t of [0.15, 0.45, 0.75, 1]) { await page.evaluate((t) => window.__cur.pulse(t), t); await snap(); } };

// Screen point of a target: a CSS selector, {at:[x,y,z]} (model coords, mm), or {part: i} (part center).
const locate = async (target) => {
  if (typeof target === "string") {
    const b = await page.locator(target).first().boundingBox();
    if (!b) throw new Error(`target not visible: ${target}`);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
  return page.evaluate((t) => {
    const THREE = app.camera.position.constructor;
    let p;
    if (t.at) p = new THREE(...t.at);
    else if (t.gizmo) { // the gizmo's center, or t.px pixels out along t.axis (e.g. onto the X arrow)
      p = app.gzProxy.position.clone();
      if (t.axis) {
        const r = document.querySelector("#view canvas").getBoundingClientRect(), scr = (v) => { v = v.clone().project(app.camera); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; };
        const a = scr(p), b = scr(p.clone().add(new THREE(...t.axis))), l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return { x: a[0] + (b[0] - a[0]) / l * t.px, y: a[1] + (b[1] - a[1]) / l * t.px, dir: [(b[0] - a[0]) / l, (b[1] - a[1]) / l] };
      }
    }
    else {
      const { S } = app, cen = S.G.cen, sum = [0, 0, 0]; let c = 0;
      for (let f = 0; f < S.nF; f++) if (S.labels[f] === t.part) { for (let k = 0; k < 3; k++) sum[k] += cen[f * 3 + k]; c++; }
      p = new THREE(sum[0] / c, sum[1] / c, sum[2] / c);
    }
    const v = p.project(app.camera), r = document.querySelector("#view canvas").getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }, target);
};

// Camera: azimuth/elevation in degrees around the model center, dist as a multiple of the framed distance.
const setCam = (c) => page.evaluate((c) => {
  const { camera, controls, S } = app, b = S.G.bbox, d = S.G.diag * 1.45 * (c.dist ?? 1);
  controls.target.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2 + (c.lift ?? 0) * S.G.diag);
  const az = (c.az * Math.PI) / 180, el = (c.el * Math.PI) / 180;
  camera.position.set(controls.target.x + d * Math.cos(el) * Math.sin(az), controls.target.y - d * Math.cos(el) * Math.cos(az), controls.target.z + d * Math.sin(el));
  camera.up.set(0, 0, 1); controls.update(); app.render();
}, c);
let cam = { az: 25, el: 15, dist: 1, lift: 0, ...(cfg.camera || {}) };

// ---------------------------------------------------------------- steps
const steps = {
  async load(s) { // open a mesh with no frames; split: false undoes the auto split that opening runs
    const f = asset(s.model || cfg.model);
    await page.evaluate(async ([name, b64]) => {
      const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
      await app.loadArrayBuffer(name, buf);
    }, [path.basename(f), readFileSync(f).toString("base64")]);
    await idle();
    if (!(s.split ?? true)) await steps.unsplit();
    await setCam(cam);
  },
  async unsplit() { // back to one unassigned part
    await page.evaluate(() => { app.S.labels.fill(0); app.S.parts.splice(1); app.S.active = 0; app.S.hist = { past: [], future: [] }; app.afterEdit(""); document.getElementById("status").textContent = ""; });
  },
  hold: (s) => hold(s.s ?? 1),
  async camera(s) { // animate to new camera values over s.s seconds (az can wrap past 360 for a spin)
    const a = { ...cam }, b = { ...cam, ...s }, k = Math.max(1, Math.round((s.s ?? 1) * fps));
    for (let i = 1; i <= k; i++) {
      const t = s.linear ? i / k : ease(i / k), c = {};
      for (const key of ["az", "el", "dist", "lift"]) c[key] = a[key] + (b[key] - a[key]) * t;
      await setCam(c); await snap();
    }
    cam = { az: b.az % 360, el: b.el, dist: b.dist, lift: b.lift };
  },
  async move(s) { const p = await locate(s.target); await cursorTo(p.x + (s.dx ?? 0), p.y + (s.dy ?? 0), s.s ?? 0.6); },
  async click(s) {
    const p = await locate(s.target);
    await cursorTo(p.x + (s.dx ?? 0), p.y + (s.dy ?? 0), s.s ?? 0.6);
    // file: the file to pick in the Open dialog the click shows. With input: set it on that <input type=file>
    // instead (a dialog opened from script, not the click itself, never fires Playwright's filechooser event).
    const chooser = s.file && !s.input ? page.waitForEvent("filechooser", { timeout: 5000 }) : null;
    for (const m of s.mods || []) await page.keyboard.down(m); // e.g. "mods": ["Shift"]
    await page.mouse.click(cur.x, cur.y, { button: s.button || "left", clickCount: s.double ? 2 : 1 });
    for (const m of s.mods || []) await page.keyboard.up(m);
    await pulse();
    if (chooser) await (await chooser).setFiles(asset(s.file));
    else if (s.file) await page.setInputFiles(s.input, asset(s.file));
    if (s.file) await page.waitForTimeout(300);
    if (s.camera) await setCam(cam = { ...cam, ...s.camera });
    if (s.wait !== false) await idle();
    await hold(s.after ?? 0.3);
  },
  async drag(s) { // drag from target by [dx, dy] pixels; "mods": ["Shift"] holds keys during the drag
    const p = await locate(s.target);
    await cursorTo(p.x + (s.dx ?? 0), p.y + (s.dy ?? 0), s.s ?? 0.6);
    await page.mouse.down(); await pulse();
    for (const m of s.mods || []) await page.keyboard.down(m);
    const by = s.along && p.dir ? [p.dir[0] * s.along, p.dir[1] * s.along] : s.by; // along: pixels along a gizmo axis
    await cursorTo(p.x + (s.dx ?? 0) + by[0], p.y + (s.dy ?? 0) + by[1], s.dragS ?? 1, true);
    await page.mouse.up(); for (const m of s.mods || []) await page.keyboard.up(m); await idle();
    await hold(s.after ?? 0.3);
  },
  async type(s) {
    if (s.target) await page.locator(s.target).fill("");
    for (const ch of String(s.text)) { await page.keyboard.type(ch); await hold(s.perChar ?? 0.12); }
  },
  async caption(s) { await page.evaluate(([t, at]) => window.__caption(t, at), [s.text || "", s.style || null]); if (s.s) await hold(s.s); },
  async set(s) { await page.locator(s.target).fill(String(s.value)); await idle(); await hold(s.after ?? 0.3); }, // e.g. a color input
  async key(s) { await page.keyboard.press(s.key); await idle(); await hold(s.after ?? 0.3); },
  async eval(s) { await page.evaluate(s.js); await idle(); }, // escape hatch: run JS in the page
  // Save a PNG of the page (or a region) to shotsDir/<name>.png. clip: a CSS selector, [x, y, w, h], or
  // {around: target, w, h} (a box centered on a target point, kept inside the page).
  async shot(s) {
    if (s.wait !== false) await idle();
    await page.evaluate(() => app.render());
    let clip;
    if (typeof s.clip === "string") clip = await page.locator(s.clip).first().boundingBox();
    else if (Array.isArray(s.clip)) clip = { x: s.clip[0], y: s.clip[1], width: s.clip[2], height: s.clip[3] };
    else if (s.clip?.around) {
      const p = await locate(s.clip.around), w = Math.min(s.clip.w, vp.width), h = Math.min(s.clip.h, vp.height);
      clip = { x: Math.max(0, Math.min(vp.width - w, p.x - w / 2)), y: Math.max(0, Math.min(vp.height - h, p.y - h / 2)), width: w, height: h };
    }
    const dir = s.name.startsWith("_") ? path.join(here, "build", "shots") : shotsDir; // "_name": a scratch shot for compare
    mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `${s.name}.png`);
    await writeFile(f, await page.screenshot({ clip }));
    shots.set(s.name, f);
    console.log(`  ${path.relative(root, f)}`);
  },
  // Put two shots side by side with a label over each, e.g. a before / after pair: {left, right, name, labels}.
  async compare(s) {
    const img = (k) => "data:image/png;base64," + readFileSync(shots.get(k) || path.join(shotsDir, `${k}.png`)).toString("base64");
    const [la, lb] = s.labels || ["Before", "After"];
    const p2 = await browser.newPage({ viewport: { width: 4000, height: 3000 }, deviceScaleFactor: cfg.deviceScaleFactor ?? 1 });
    await p2.setContent(`<body style="margin:0;background:#1b1d22;display:inline-flex;gap:6px;padding:6px">
      ${[[img(s.left), la], [img(s.right), lb]].map(([u, l]) => `<figure style="margin:0;position:relative">
        <img src="${u}" style="display:block;border-radius:6px">
        <figcaption style="position:absolute;left:10px;top:10px;padding:4px 12px;border-radius:6px;background:#000b;color:#fff;
          font:600 18px system-ui,sans-serif">${l}</figcaption></figure>`).join("")}</body>`);
    const box = await p2.locator("body").boundingBox();
    mkdirSync(shotsDir, { recursive: true });
    const f = path.join(shotsDir, `${s.name}.png`);
    await writeFile(f, await p2.screenshot({ clip: box }));
    await p2.close();
    console.log(`  ${path.relative(root, f)}`);
  },
};
const shots = new Map();

await page.goto(`${ORIGIN}/app/index.html`);
await page.waitForFunction(() => window.app && window.__cur, null, { timeout: 60000 });
if (cfg.css) await page.addStyleTag({ content: cfg.css });
for (const [i, s] of cfg.steps.entries()) {
  if (!steps[s.do]) throw new Error(`step ${i}: unknown action "${s.do}"`);
  const t0 = Date.now(), n0 = n;
  await steps[s.do](s);
  console.log(`step ${i} ${s.do}: ${n - n0} frames, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (errors.length) break;
}
await browser.close();
if (errors.length) { console.error("FAILED:", errors.join(" | ")); process.exit(1); }

// ---------------------------------------------------------------- encode
if (!gifOn) process.exit(0);
const g = cfg.gif || {};
const width = g.width ?? 800, colors = g.colors ?? 128, dither = g.dither ?? "sierra2_4a";
const crop = g.crop ? `crop=${g.crop[2]}:${g.crop[3]}:${g.crop[0]}:${g.crop[1]},` : ""; // gif.crop: [x, y, w, h] in page pixels
const scale = `fps=${fps},${crop}scale=${width}:-1:flags=lanczos`;
const ff = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", path.join(framesDir, "f%05d.png"),
  "-filter_complex", `[0:v]${scale},split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=${dither}:diff_mode=rectangle`,
  "-loop", String(g.loop ?? 0), out], { stdio: "inherit" });
if (ff.status !== 0) process.exit(ff.status || 1);
if (!flag("--keep-frames")) rmSync(framesDir, { recursive: true, force: true });
console.log(`${out}: ${n} frames, ${(n / fps).toFixed(1)} s, ${(statSync(out).size / 1048576).toFixed(2)} MB`);
