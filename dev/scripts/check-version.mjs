#!/usr/bin/env node
/**
 * Fail if dev/VERSION diverges from synced manifests.
 * Run via: node dev/scripts/check-version.mjs  (also wired into ./run lint/check)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const devRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const versionPath = path.join(devRoot, "VERSION");

if (!fs.existsSync(versionPath)) {
  console.error(`Missing ${versionPath}`);
  process.exit(1);
}

const expected = fs.readFileSync(versionPath, "utf8").trim();
const mismatches = [];

function checkJsonVersion(relativePath) {
  const filePath = path.join(devRoot, relativePath);
  const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (json.version !== expected) {
    mismatches.push(`${relativePath}: ${json.version} (expected ${expected})`);
  }
}

function checkExpoVersion() {
  const filePath = path.join(devRoot, "apps/mobile/app.json");
  const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (json.expo?.version !== expected) {
    mismatches.push(`apps/mobile/app.json expo.version: ${json.expo?.version} (expected ${expected})`);
  }
}

function checkCargoWorkspaceVersion() {
  const filePath = path.join(devRoot, "Cargo.toml");
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/\[workspace\.package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/);
  const found = match?.[1];
  if (found !== expected) {
    mismatches.push(`Cargo.toml [workspace.package].version: ${found ?? "?"} (expected ${expected})`);
  }
}

for (const target of [
  "apps/desktop/package.json",
  "apps/electron/package.json",
  "apps/mobile/package.json",
  "apps/shared/package.json",
]) {
  checkJsonVersion(target);
}
checkExpoVersion();
checkCargoWorkspaceVersion();

if (mismatches.length > 0) {
  console.error("Version mismatch — run: npm run sync-version --prefix dev\n");
  for (const line of mismatches) console.error(`  • ${line}`);
  process.exit(1);
}

console.log(`version OK (${expected})`);
