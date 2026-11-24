// Serves app/ with the exact headers from app/staticwebapp.config.json, opens it in Chromium, loads a model,
// calls every AI provider, and fails on any Content-Security-Policy violation the browser reports.
//   node test/csp.browser.mjs [staticwebapp.config.json]
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const app = path.join(root, "app");
const config = JSON.parse(readFileSync(process.argv[2] || path.join(app, "staticwebapp.config.json"), "utf8"));
const { chromium } = createRequire(path.join(root, "plugin", "package.json"))("playwright");

// Cloudflare Web Analytics adds this tag to every page it serves at splitmesh.carrigg.dev. #105 shipped a CSP that blocked it.
const CLOUDFLARE = `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"test"}'></script>`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ...config.mimeTypes };

const server = createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html");
  const file = path.join(app, rel);
  if (!file.startsWith(app + path.sep) || !existsSync(file)) { res.writeHead(404).end(); return; }
  let body = readFileSync(file);
  if (file.endsWith(".html")) body = body.toString().replace("</body>", CLOUDFLARE + "</body>");
  res.writeHead(200, { ...config.globalHeaders, "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }).end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(() => {
  window.__violations = [];
  document.addEventListener("securitypolicyviolation", (e) => window.__violations.push(`${e.effectiveDirective} blocks ${e.blockedURI}`));
});
// Offline runs: serve the CDN's files from plugin/node_modules. The browser checks the CSP before the request reaches this route.
const nm = path.join(root, "plugin", "node_modules");
await page.route("https://cdn.jsdelivr.net/npm/**", (r) => {
  const m = new URL(r.request().url()).pathname.match(/^\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.*)$/);
  const f = m && path.join(nm, m[1], m[2]);
  return f && existsSync(f) ? r.fulfill({ body: readFileSync(f), contentType: "text/javascript" }) : r.continue();
});
await page.route("https://static.cloudflareinsights.com/**", (r) => r.fulfill({ body: "", contentType: "text/javascript" }));

// Not page.waitForFunction: older Playwright evaluates its predicate as a string, which this CSP blocks.
async function until(fn, ms) {
  for (const end = Date.now() + ms; !(await page.evaluate(fn)); await page.waitForTimeout(200))
    if (Date.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${fn}`);
}
let stuck = "";
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await until(() => !!window.app, 30000);
  await page.setInputFiles("#fileIn", path.join(root, "examples", "robot", "robot.stl"));
  await until(() => /robot\.stl/.test(document.getElementById("fileName").textContent), 60000);
  await page.evaluate(async () => {
    const { PROVIDERS } = await import("./llm-direct.js");
    const urls = [...Object.values(PROVIDERS).map((p) => p.base_url), "http://localhost:1234/v1"];
    await Promise.all(urls.map((u) => fetch(u + "/models", { signal: AbortSignal.timeout(5000) }).catch(() => {})));
  });
  await page.waitForTimeout(500);
} catch (e) { stuck = `The page did not finish (${e.message.split("\n")[0]})`; }
const violations = [...new Set(await page.evaluate(() => window.__violations))];
await browser.close(); server.close();

if (violations.length || stuck) {
  console.error([...violations.map((v) => `${v}: allow it in the Content-Security-Policy in app/staticwebapp.config.json`), stuck].filter(Boolean).join("\n"));
  process.exit(1);
}
console.log("CSP: no violations (page, robot.stl, AI providers, Cloudflare beacon)");
