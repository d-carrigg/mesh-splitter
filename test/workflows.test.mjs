import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const dir = new URL("../.github/workflows/", import.meta.url);
const uses = new Map();
for (const f of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
  for (const [, action, ref] of readFileSync(new URL(f, dir), "utf8").matchAll(/uses:\s*([\w.-]+\/[\w.-]+)(?:\/[^@\s]*)?@([^\s#]+)/g)) {
    uses.set(`${action}@${ref}`, { action, ref, file: f });
  }
}

test("every action a workflow uses points at a tag or branch that exists", async () => {
  const missing = [];
  await Promise.all([...uses.values()].map(async ({ action, ref, file }) => {
    if (/^[0-9a-f]{40}$/.test(ref)) return;
    const url = `https://github.com/${action}`;
    const { stdout } = await promisify(execFile)("git", ["ls-remote", url, `refs/tags/${ref}`, `refs/heads/${ref}`]);
    if (!stdout.trim()) missing.push(`${file}: ${action}@${ref} has no tag or branch "${ref}". `
      + `Pin a ref that exists (git ls-remote --tags ${url}); some actions, like astral-sh/setup-uv, publish only vX.Y.Z tags.`);
  }));
  assert.deepEqual(missing, []);
});
