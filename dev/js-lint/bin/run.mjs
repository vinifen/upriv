#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const tool = process.argv[2];
const args = process.argv.slice(3);

if (tool !== "eslint" && tool !== "prettier") {
  console.error("usage: run.mjs eslint|prettier [args...]");
  process.exit(2);
}

let bin;
try {
  const pkgDir = path.dirname(require.resolve(`${tool}/package.json`));
  const pkg = require(`${tool}/package.json`);
  const binField = pkg.bin;
  const rel =
    typeof binField === "string" ? binField : binField[tool] ?? Object.values(binField)[0];
  bin = path.join(pkgDir, rel);
} catch {
  console.error(`cannot resolve ${tool} — run: npm install --prefix js-lint`);
  process.exit(1);
}

const child = spawn(process.execPath, [bin, ...args], { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
