#!/usr/bin/env node
// Entry point for the Claude Code plugin: installs the command line's two npm packages on first use,
// then runs cli/split.mjs with the same arguments.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [major] = process.versions.node.split(".").map(Number);
if (major < 20) { console.error(`mesh-splitter needs Node.js 20 or newer (found ${process.version}): https://nodejs.org`); process.exit(1); }

if (!["fflate", "@xmldom/xmldom"].every((m) => fs.existsSync(path.join(root, "node_modules", m, "package.json")))) {
  console.error("First run: installing command-line packages (npm ci)...");
  const r = spawnSync("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"],
    { cwd: root, stdio: ["ignore", "inherit", "inherit"], shell: process.platform === "win32" });
  if (r.status !== 0) { console.error(`npm ci failed in ${root}${r.error ? `: ${r.error.message}` : ""}`); process.exit(r.status || 1); }
}

await import(pathToFileURL(path.join(root, "cli", "split.mjs")).href); // split.mjs runs on import, reading process.argv
