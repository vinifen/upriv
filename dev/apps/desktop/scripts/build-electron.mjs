/**
 * Cross-platform Electron renderer build (sets ELECTRON=true for vite outDir).
 * Unix `ELECTRON=true …` does not work under cmd.exe on Windows.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env, ELECTRON: "true" };

function runNodeScript(scriptRel, args) {
  const script = path.join(cwd, "node_modules", scriptRel);
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

runNodeScript(path.join("typescript", "bin", "tsc"), ["--noEmit"]);
runNodeScript(path.join("vite", "bin", "vite.js"), [
  "build",
  "--configLoader",
  "native",
]);
