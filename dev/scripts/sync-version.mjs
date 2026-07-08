#!/usr/bin/env node
/**
 * Propagate dev/VERSION to npm/Cargo/Expo manifests.
 * Run after bumping VERSION: node dev/scripts/sync-version.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const devRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const versionPath = path.join(devRoot, "VERSION");

if (!fs.existsSync(versionPath)) {
  console.error(`Missing ${versionPath} — create it with a semver (e.g. 0.1.0).`);
  process.exit(1);
}

const version = fs.readFileSync(versionPath, "utf8").trim();

const SEMVER =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

if (!SEMVER.test(version)) {
  console.error(`Invalid semver in ${versionPath}: ${JSON.stringify(version)}`);
  process.exit(1);
}

const jsonTargets = [
  "apps/desktop/package.json",
  "apps/electron/package.json",
  "apps/mobile/package.json",
  "apps/shared/package.json",
];

function setJsonVersion(relativePath) {
  const filePath = path.join(devRoot, relativePath);
  const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (json.version === version) return false;
  json.version = version;
  fs.writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`updated ${relativePath}`);
  return true;
}

function setExpoVersion() {
  const relativePath = "apps/mobile/app.json";
  const filePath = path.join(devRoot, relativePath);
  const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (json.expo?.version === version) return false;
  json.expo.version = version;
  fs.writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`updated ${relativePath}`);
  return true;
}

function setWorkspaceCargoVersion() {
  const relativePath = "Cargo.toml";
  const filePath = path.join(devRoot, relativePath);
  let content = fs.readFileSync(filePath, "utf8");

  if (!content.includes("[workspace.package]")) {
    content = `${content.trim()}\n\n[workspace.package]\nversion = "${version}"\nauthors = ["Upriv"]\nedition = "2021"\nrust-version = "1.77.2"\n`;
    fs.writeFileSync(filePath, content);
    console.log(`added [workspace.package] to ${relativePath}`);
    return true;
  }

  const sectionMatch = content.match(/\[workspace\.package\]([\s\S]*?)(?=\n\[|$)/);
  if (!sectionMatch) {
    console.error(`Could not parse [workspace.package] in ${relativePath}`);
    process.exit(1);
  }

  const section = sectionMatch[1];
  const versionLine = /^\s*version\s*=\s*"[^"]*"/m;
  if (!versionLine.test(section)) {
    const nextSection = section.replace(/^\n?/, `\nversion = "${version}"\n`);
    const next = content.replace(sectionMatch[0], `[workspace.package]${nextSection}`);
    fs.writeFileSync(filePath, next);
    console.log(`added version to ${relativePath}`);
    return true;
  }

  const nextSection = section.replace(versionLine, `version = "${version}"`);
  const next = content.replace(sectionMatch[0], `[workspace.package]${nextSection}`);
  if (next === content) return false;
  fs.writeFileSync(filePath, next);
  console.log(`updated ${relativePath}`);
  return true;
}

let changed = false;
for (const target of jsonTargets) {
  if (setJsonVersion(target)) changed = true;
}
if (setExpoVersion()) changed = true;
if (setWorkspaceCargoVersion()) changed = true;

if (!changed) {
  console.log(`all manifests already at ${version}`);
}
