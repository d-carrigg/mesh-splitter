import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const TEXT = /\.(md|html|css|js|mjs|py|ya?ml|toml|txt|json|cfg|ini)$|^(LICENSE|README)/;
const AMERICAN = "Mesh Splitter is written in American English";
const RULES = [
  [/\bcolou?rs?\b/i, (w) => /colour/i.test(w) && `"${w}": ${AMERICAN}, write "color"`],
  [/\bneighbou?r/i, (w) => /neighbour/i.test(w) && `"${w}": ${AMERICAN}, write "neighbor"`],
  [/\b(centre|metre|litre|fibre)s?\b/i, (w) => `"${w}": ${AMERICAN}, write "${w.replace(/re(s?)$/i, "er$1")}"`],
  [/\bgrey/i, (w) => `"${w}": ${AMERICAN}, write "gray"`],
  [/\bAI[- ](generated|made|created)\b|\b(generated|made|created) (by|with) AI\b|\bfor AI (models|figures|meshes)\b/i,
    (w) => `"${w}": Mesh Splitter is a general mesh-splitting tool, never describe it as for AI-made models (the Meshy credit for the screenshot model is the only allowed mention, marked wording-ok)`],
];

test("text follows the project's wording rules", () => {
  const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter((f) => TEXT.test(f.split("/").pop()) && !/lock/.test(f) && f !== "test/wording.test.mjs");
  const errors = [];
  for (const f of files) {
    readFileSync(new URL(f, root), "utf8").split("\n").forEach((line, i) => {
      if (line.includes("wording-ok:")) return;
      for (const [re, why] of RULES) {
        const g = new RegExp(re.source, re.flags + "g");
        for (const m of line.matchAll(g)) {
          const word = /\s|-/.test(m[0]) || /^(\p{Lu}?[^\p{Lu}]*|[^\p{Ll}]*)$/u.test(m[0]);
          const msg = word && why(m[0]);
          if (msg) errors.push(`${f}:${i + 1} ${msg}. A deliberate exception (a name we don't control) ends the line with "wording-ok: <reason>".`);
        }
      }
    });
  }
  assert.deepEqual(errors, []);
});
