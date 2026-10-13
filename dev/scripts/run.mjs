// Dev workspace runner — lint, tests, and local desktop/mobile with a cache wipe.
// dev/r, dev/r.ps1, and dev/r.cmd start this file. npm scripts call it too.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const devRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(devRoot);

let failed = 0;

const usage = `Upriv dev workspace runner (run from dev/)

Usage:
  ./r <command>
  npm run <command>          # lint, lint:fix, test, check, desktop, mobile, help

Commands (short or full name):
  h  help       Show this help
  l  lint       Run all linters (continues on failure; exit 1 if any step failed)
  f  lint-fix   Apply auto-fixes (continues on failure; exit 1 if any step failed)
  t  test       Run all code tests
  c  check      lint + test
  d  desktop    Wipe Vite cache, free port 1420 if needed, then Electron + upriv-daemon
  m  mobile     Wipe Metro/Expo cache, then expo start --clear
                -a opens Android (./r m -a)

What each command runs:

  lint
    • Version:  check-version.mjs (VERSION vs manifests)
    • Rust:     rustfmt --check, clippy (-D warnings)
    • UniFFI:   regenerate Kotlin and diff vs crates/upriv-ffi
    • Shared:   tsc --noEmit, eslint, prettier --check
    • Desktop:  tsc, eslint, prettier --check
    • Electron: tsc, eslint, prettier --check
    • Mobile:   tsc, eslint, prettier --check

  lint-fix
    • Rust:     rustfmt, clippy --fix
    • Shared:   prettier --write, eslint --fix
    • Desktop:  prettier --write, eslint --fix
    • Electron: prettier --write, eslint --fix
    • Mobile:   prettier --write, eslint --fix
    • TypeScript: tsc --noEmit (shared, desktop, electron, mobile)

  test
    • Rust:     cargo test --workspace
    • Shared:   vitest
    • Desktop:  vitest
    • Electron: vitest (daemon protocol / IPC allowlist)
    • Mobile:   vitest (modules without RN runtime)

  check
    • All lint steps, then all test steps

  desktop
    • Remove apps/desktop/.vite-cache and node_modules/.vite
    • Free TCP 1420 if a leftover Vite is still bound
    • npm run electron:dev (daemon build + Vite + Electron)

  mobile
    • Remove apps/mobile/.expo and node_modules/.cache
    • npx expo start --clear (from apps/mobile)

Rust-only (npm):
  npm run rust:lint    check fmt + clippy
  npm run rust:fix     apply fmt + clippy --fix

Notes:
  • Requires node_modules in js-lint/, apps/shared, apps/desktop,
    apps/electron, apps/mobile
  • Install: npm install --prefix js-lint && npm install --prefix apps/<app>
  • ESLint + Prettier live in js-lint/ (JS/TS only). Rust is cargo fmt/clippy.
    Each app only adds React plugins / ignores.
  • max-len and import-newlines are "warn" in config but \`npm run lint\` uses
    --max-warnings 0, so they fail CI like errors.

Examples:
  ./r h
  ./r l
  ./r f
  ./r t
  ./r c
  ./r d
  ./r m
  ./r m -a
`;

function npmBin() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function npxBin() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function run(command, args, cwd = devRoot) {
  const shell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell });
  if (result.error) {
    console.error(result.error.message);
    return false;
  }
  return result.status === 0;
}

function runReplace(command, args, cwd = devRoot) {
  const shell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

function step(label, fn) {
  console.log("");
  console.log(`==> ${label}`);
  if (fn()) {
    console.log(`OK  ${label}`);
  } else {
    console.error(`FAIL ${label}`);
    failed = 1;
  }
}

function requireNodeModules(app) {
  if (!fs.existsSync(path.join(devRoot, "apps", app, "node_modules"))) {
    console.error(`Missing apps/${app}/node_modules — run: npm install --prefix apps/${app}`);
    return false;
  }
  return true;
}

function requireLintModules() {
  if (!fs.existsSync(path.join(devRoot, "js-lint", "node_modules"))) {
    console.error("Missing js-lint/node_modules — run: npm install --prefix js-lint");
    return false;
  }
  return true;
}

function runTsc(app) {
  if (!requireNodeModules(app)) return false;
  return run(npxBin(), ["tsc", "--noEmit"], path.join(devRoot, "apps", app));
}

function finish(name) {
  console.log("");
  if (failed) {
    console.error(`${name} finished with failures.`);
    process.exit(1);
  }
  console.log(`${name} passed.`);
}

// scripts/check-uniffi-kotlin.sh is still a shell script. The runner itself is Node.
function bashExecutable() {
  if (process.platform !== "win32") return "bash";
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
  for (const root of roots) {
    const candidate = path.join(root, "Git", "bin", "bash.exe");
    if (fs.existsSync(candidate)) return candidate;
  }
  return "bash";
}

function lintJsApp(label, app) {
  step(`${label} (tsc)`, () => runTsc(app));
  if (requireLintModules() && requireNodeModules(app)) {
    step(`${label} (eslint)`, () => run(npmBin(), ["run", "lint", "--prefix", `apps/${app}`]));
    step(`${label} (prettier)`, () =>
      run(npmBin(), ["run", "format:check", "--prefix", `apps/${app}`]),
    );
  } else {
    step(`${label} (eslint)`, () => false);
    step(`${label} (prettier)`, () => false);
  }
}

function lintFixJsApp(label, app) {
  if (requireLintModules() && requireNodeModules(app)) {
    step(`${label} (prettier --write)`, () =>
      run(npmBin(), ["run", "format", "--prefix", `apps/${app}`]),
    );
    step(`${label} (eslint --fix)`, () =>
      run(npmBin(), ["run", "lint:fix", "--prefix", `apps/${app}`]),
    );
  } else {
    step(`${label} (prettier --write)`, () => false);
    step(`${label} (eslint --fix)`, () => false);
  }
}

function lintSteps() {
  step("Version (check-version.mjs)", () =>
    run(process.execPath, ["scripts/check-version.mjs"]),
  );
  step("Rust (rustfmt + clippy)", () => run(npmBin(), ["run", "rust:lint"]));
  step("UniFFI Kotlin (diff vs crates/upriv-ffi)", () =>
    run(bashExecutable(), ["scripts/check-uniffi-kotlin.sh"]),
  );
  lintJsApp("Shared", "shared");
  lintJsApp("Desktop", "desktop");
  lintJsApp("Electron", "electron");
  lintJsApp("Mobile", "mobile");
}

function lintFixSteps() {
  step("Rust (rustfmt + clippy --fix)", () => run(npmBin(), ["run", "rust:fix"]));
  lintFixJsApp("Shared", "shared");
  lintFixJsApp("Desktop", "desktop");
  lintFixJsApp("Electron", "electron");
  lintFixJsApp("Mobile", "mobile");
  step("Shared (tsc)", () => runTsc("shared"));
  step("Desktop (tsc)", () => runTsc("desktop"));
  step("Electron (tsc)", () => runTsc("electron"));
  step("Mobile (tsc)", () => runTsc("mobile"));
}

function testApp(label, app) {
  if (requireNodeModules(app)) {
    step(`${label} (vitest)`, () => run(npmBin(), ["test", "--prefix", `apps/${app}`]));
  } else {
    step(`${label} (vitest)`, () => false);
  }
}

function testSteps() {
  step("Rust (cargo test --workspace)", () => run("cargo", ["test", "--workspace"]));
  testApp("Shared", "shared");
  testApp("Desktop", "desktop");
  testApp("Electron", "electron");
  testApp("Mobile", "mobile");
}

function removeIfPresent(target) {
  if (!fs.existsSync(target)) return;
  const rel = path.relative(devRoot, target).split(path.sep).join("/");
  console.log(`  rm -rf ${rel}`);
  fs.rmSync(target, { recursive: true, force: true });
}

function commandExists(name) {
  const checker = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(checker, [name], { stdio: "ignore" });
  return result.status === 0;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function netstatListeners(port) {
  const result = spawnSync("netstat", ["-ano"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) return [];
  const suffix = `:${port}`;
  const pids = new Set();
  for (const line of result.stdout.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] !== "TCP" || parts[3] !== "LISTENING") continue;
    if (!parts[1]?.endsWith(suffix)) continue;
    if (parts[4] && parts[4] !== "0") pids.add(parts[4]);
  }
  return [...pids];
}

// Vite uses strictPort 1420. A leftover `./r d` keeps the port and the next start fails.
function freeTcpPort(port) {
  if (commandExists("fuser")) {
    const probe = spawnSync("fuser", [`${port}/tcp`], { stdio: "ignore" });
    if (probe.status === 0) {
      console.log(`  killing listener on ${port}`);
      spawnSync("fuser", ["-k", `${port}/tcp`], { stdio: "ignore" });
      sleepMs(300);
      const still = spawnSync("fuser", [`${port}/tcp`], { stdio: "ignore" });
      if (still.status === 0) {
        spawnSync("fuser", ["-k", "-KILL", `${port}/tcp`], { stdio: "ignore" });
      }
    }
    return;
  }

  let pids = [];
  if (commandExists("lsof")) {
    const listed = spawnSync("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"], { encoding: "utf8" });
    pids = (listed.stdout ?? "")
      .split(/\s+/)
      .map((pid) => pid.trim())
      .filter(Boolean);
  }
  if (pids.length === 0 && commandExists("netstat")) {
    pids = netstatListeners(port);
  }
  if (pids.length === 0) return;

  console.log(`  killing listener on ${port}`);
  if (commandExists("taskkill")) {
    for (const pid of pids) {
      spawnSync("taskkill", ["/F", "/PID", pid], { stdio: "ignore" });
    }
    return;
  }
  for (const pid of pids) spawnSync("kill", [pid], { stdio: "ignore" });
  sleepMs(300);
  for (const pid of pids) spawnSync("kill", ["-9", pid], { stdio: "ignore" });
}

function cmdDesktop() {
  if (!requireNodeModules("desktop") || !requireNodeModules("electron")) process.exit(1);
  console.log("");
  console.log("==> Clearing Vite cache");
  removeIfPresent(path.join(devRoot, "apps", "desktop", ".vite-cache"));
  removeIfPresent(path.join(devRoot, "apps", "desktop", "node_modules", ".vite"));
  console.log("");
  console.log("==> Freeing port 1420 if in use");
  freeTcpPort(1420);
  console.log("");
  console.log("==> Desktop (electron:dev)");
  runReplace(npmBin(), ["run", "electron:dev"]);
}

function mobileArgs(args) {
  return args.map((arg) => (arg === "-a" ? "--android" : arg));
}

function cmdMobile(extraArgs) {
  if (!requireNodeModules("mobile")) process.exit(1);
  console.log("");
  console.log("==> Clearing Metro / Expo cache");
  removeIfPresent(path.join(devRoot, "apps", "mobile", ".expo"));
  removeIfPresent(path.join(devRoot, "apps", "mobile", "node_modules", ".cache"));
  console.log("");
  console.log("==> Mobile (expo start --clear)");
  runReplace(
    npxBin(),
    ["expo", "start", "--clear", ...mobileArgs(extraArgs)],
    path.join(devRoot, "apps", "mobile"),
  );
}

function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "l":
    case "lint":
      failed = 0;
      lintSteps();
      finish("Lint");
      break;
    case "f":
    case "lint-fix":
    case "lint:fix":
      failed = 0;
      lintFixSteps();
      finish("Lint-fix");
      break;
    case "t":
    case "test":
      failed = 0;
      testSteps();
      finish("Tests");
      break;
    case "c":
    case "check":
      failed = 0;
      lintSteps();
      testSteps();
      finish("Check");
      break;
    case "d":
    case "desktop":
      cmdDesktop();
      break;
    case "m":
    case "mobile":
      cmdMobile(rest);
      break;
    case "h":
    case "help":
    case "-h":
    case "--help":
      process.stdout.write(usage);
      process.exit(0);
      break;
    case undefined:
      process.stdout.write(usage);
      process.exit(1);
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      process.stdout.write(usage);
      process.exit(1);
  }
}

main(process.argv.slice(2));
