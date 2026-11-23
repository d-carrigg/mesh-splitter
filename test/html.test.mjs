import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { html, trusted, setHTML } from "../app/html.js";

test("html`` escapes text from files and providers, and keeps nested html`` as markup", () => {
  const conn = { d: '<img src=x onerror="alert(1)">' }, name = "Arm & 'hand'";
  assert.equal(String(html`<span>${conn.d} mm</span>`), "<span>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; mm</span>");
  assert.equal(String(html`<b title="${name}">${[html`<i>${name}</i>`, 2]}</b>`),
    '<b title="Arm &amp; &#39;hand&#39;"><i>Arm &amp; &#39;hand&#39;</i>2</b>');
  assert.equal(String(html`${trusted("<svg/>")}${undefined}${null}`), "<svg/>");
});

test("setHTML takes only html``", () => {
  const el = { innerHTML: "" };
  assert.throws(() => setHTML(el, "<b>x</b>"), TypeError);
  setHTML(el, html`<b>${"<x>"}</b>`);
  assert.equal(el.innerHTML, "<b>&lt;x&gt;</b>");
});

test("app/ writes markup only through setHTML", () => {
  const dir = new URL("../app/", import.meta.url), bad = [];
  for (const f of readdirSync(dir).filter((f) => /\.(m?js|html)$/.test(f) && f !== "html.js")) {
    readFileSync(new URL(f, dir), "utf8").split("\n").forEach((line, i) => {
      for (const m of line.matchAll(/\.(innerHTML|outerHTML|insertAdjacentHTML)\b|document\.write\(/g))
        bad.push(`app/${f}:${i + 1} uses ${m[0]}: use setHTML(el, html\`...\`) from app/html.js, which escapes every \${} (#98)`);
    });
  }
  assert.deepEqual(bad, []);
});
