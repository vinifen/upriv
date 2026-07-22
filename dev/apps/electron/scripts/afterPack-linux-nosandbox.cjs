/**
 * AppImage FUSE mounts with `nosuid`, so `chrome-sandbox` cannot work.
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
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "linux") return;

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
};
