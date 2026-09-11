/**
 * afterPack hooks for Linux AppImage sandbox wrap + Windows .exe icon embed.
 *
 * Windows: electron-builder's built-in rcedit path pulls `winCodeSign`, whose
 * cache extract needs Developer Mode (symlinks). We keep
 * `signAndEditExecutable: false` and apply the icon with the `rcedit`
 * devDependency (vendored `bin/rcedit-*.exe`, integrity via package-lock).
 * Linux packaging never runs that binary.
 */
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { spawnSync } = require("node:child_process");

const requireFromHere = createRequire(__filename);

function resolveRceditExe() {
  // `rcedit` is ESM-only; resolve the package entry, then the vendored exe.
  const entry = requireFromHere.resolve("rcedit");
  const exeName =
    process.arch === "ia32" || process.arch === "arm" ? "rcedit.exe" : "rcedit-x64.exe";
  const exe = path.join(path.dirname(entry), "..", "bin", exeName);
  if (!fs.existsSync(exe)) {
    throw new Error(`[afterPack] rcedit binary missing at ${exe} — run npm ci in apps/electron`);
  }
  return exe;
}

function applyWindowsIcon(context) {
  const appOutDir = context.appOutDir;
  const executableName =
    context.packager.executableName ||
    context.packager.appInfo?.productFilename ||
    context.packager.appInfo?.name ||
    "Upriv";
  const exePath = path.join(appOutDir, `${executableName}.exe`);
  const iconPath = path.join(__dirname, "../build/icons/icon.ico");

  if (!fs.existsSync(exePath)) {
    console.warn(`[afterPack] skip win icon: missing ${exePath}`);
    return;
  }
  if (!fs.existsSync(iconPath)) {
    console.warn(`[afterPack] skip win icon: missing ${iconPath}`);
    return;
  }

  const rcedit = resolveRceditExe();
  const result = spawnSync(rcedit, [exePath, "--set-icon", iconPath], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `[afterPack] rcedit failed (status ${result.status}): ${result.stderr || result.stdout}`,
    );
  }
  console.log(`[afterPack] embedded Windows icon into ${executableName}.exe`);
}

/**
 * Linux AppImage FUSE mounts with `nosuid`, so `chrome-sandbox` cannot work.
 * Chromium aborts in setuid_sandbox_host.cc *before* Electron main.js runs —
 * so `app.commandLine.appendSwitch("no-sandbox")` is too late for AppImage.
 *
 * ## Why we wrap *all* Linux linux-unpacked trees (AppImage + .deb)
 *
 * electron-builder builds AppImage and .deb from the **same** `linux-unpacked`
 * tree, so afterPack cannot skip the wrap for .deb only without breaking
 * AppImage on machines where Chromium refuses to start without early
 * `--no-sandbox` (common under AppArmor / FUSE).
 *
 * Safety is at **runtime**, not pack time:
 * - `$APPIMAGE` set **and** names an existing file → disable sandbox (AppImage)
 * - otherwise → run the real binary with sandbox (.deb / unpacked)
 *
 * Requiring a real file matches Rust/`main.ts` so a spoofed `APPIMAGE=1` on a
 * `.deb` install does not drop chrome-sandbox. AppImageKit always sets a path.
 *
 * Do **not** restore `linux.executableArgs: ["--no-sandbox"]` in package.json
 * (that forced no-sandbox on .deb too).
 */
function applyLinuxNosandboxWrap(context) {
  const appOutDir = context.appOutDir;
  const executableName = context.packager.executableName;
  const binaryPath = path.join(appOutDir, executableName);
  const realBinaryPath = path.join(appOutDir, `${executableName}.bin`);

  if (!fs.existsSync(binaryPath)) {
    console.warn(`[afterPack] skip: missing ${binaryPath}`);
    return;
  }

  // Already wrapped (rebuild) — do not double-wrap.
  if (fs.existsSync(realBinaryPath)) {
    console.log(`[afterPack] already wrapped: ${executableName}.bin`);
    return;
  }

  fs.renameSync(binaryPath, realBinaryPath);

  const wrapper = `#!/bin/bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
# AppImageKit sets APPIMAGE to the real file; .deb does not — keep chrome-sandbox.
# Require -f so a spoofed APPIMAGE=1 cannot disable sandbox on .deb.
if [ -n "\${APPIMAGE:-}" ] && [ -f "\$APPIMAGE" ]; then
  export ELECTRON_DISABLE_SANDBOX=1
  exec "$DIR/${executableName}.bin" --no-sandbox --disable-setuid-sandbox "$@"
fi
exec "$DIR/${executableName}.bin" "$@"
`;

  fs.writeFileSync(binaryPath, wrapper, { mode: 0o755 });
  console.log(
    `[afterPack] wrapped ${executableName} → ${executableName}.bin (no-sandbox only when APPIMAGE is set)`,
  );
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName === "win32") {
    applyWindowsIcon(context);
    return;
  }
  if (context.electronPlatformName === "linux") {
    applyLinuxNosandboxWrap(context);
  }
};
