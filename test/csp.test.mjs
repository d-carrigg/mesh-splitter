import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROVIDERS } from "../app/llm-direct.js";

const read = (f) => readFileSync(new URL(`../app/${f}`, import.meta.url), "utf8");
const csp = Object.fromEntries(JSON.parse(read("staticwebapp.config.json")).globalHeaders["Content-Security-Policy"]
  .split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
const page = read("index.html");

// Scripts the host adds to every page at splitmesh.carrigg.dev, which no file in app/ mentions:
// Cloudflare Web Analytics, blocked until #105.
const HOST_INJECTED = ["https://static.cloudflareinsights.com/beacon.min.js"];

function allows(directive, url) {
  const list = csp[directive] ?? csp["default-src"], u = new URL(url, "https://splitmesh.carrigg.dev/");
  return list.some((s) => s === "'self'" ? u.origin === "https://splitmesh.carrigg.dev"
    : s === u.protocol || s === u.origin || (s.endsWith(":*") && `${u.protocol}//${u.hostname}` === s.slice(0, -2)));
}

test("the site's CSP allows every script, style and request the page makes", () => {
  const blocked = [];
  const want = (directive, urls) => urls.forEach((u) => allows(directive, u) || blocked.push(`${directive} blocks ${u}: add its origin to ${directive} in app/staticwebapp.config.json`));
  want("script-src", [...Object.values(JSON.parse(page.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports),
    ...[...page.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]), ...HOST_INJECTED]);
  want("style-src", [...page.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]));
  want("connect-src", [...Object.values(PROVIDERS).map((p) => p.base_url), "http://localhost:1234/v1"]);
  assert.deepEqual(blocked, []);
});
