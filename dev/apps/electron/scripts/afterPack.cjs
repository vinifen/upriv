/**
 * afterPack hooks for Linux AppImage sandbox wrap + Windows .exe icon embed.
 *
 * Windows: electron-builder's built-in rcedit path pulls `winCodeSign`, whose
 * cache extract needs Developer Mode (symlinks). We keep
 * `signAndEditExecutable: false` and apply the icon with a standalone rcedit.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const https = require("node:https");

const RCEDIT_VERSION = "v2.0.0";
const RCEDIT_URL = `https://github.com/electron/rcedit/releases/download/${RCEDIT_VERSION}/rcedit-x64.exe`;

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          file.close();
          fs.unlinkSync(dest);
          downloadFile(res.headers.location, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          reject(new Error(`download ${url} → HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
      })
      .on("error", (err) => {
        file.close();
        try {
          fs.unlinkSync(dest);
        } catch {
          /* ignore */
        }
        reject(err);
      });
  });
}

async function ensureRcedit(toolsDir) {
  const exe = path.join(toolsDir, "rcedit-x64.exe");
  if (fs.existsSync(exe) && fs.statSync(exe).size > 100_000) {
    return exe;
  }
  fs.mkdirSync(toolsDir, { recursive: true });
  const tmp = `${exe}.download`;
  console.log(`[afterPack] downloading rcedit ${RCEDIT_VERSION}…`);
  await downloadFile(RCEDIT_URL, tmp);
  fs.renameSync(tmp, exe);
  return exe;
}

async function applyWindowsIcon(context) {
  const appOutDir = context.appOutDir;
  const executableName =
    context.packager.executableName ||
    context.packager.appInfo?.productFilename ||
    context.packager.appInfo?.name ||
    "Upriv";
  const exePath = path.join(appOutDir, `${executableName}.exe`);
  const iconPath = path.join(__dirname, "../build/icons/icon.ico");
  const toolsDir = path.join(__dirname, "../build/tools");

  if (!fs.existsSync(exePath)) {
    console.warn(`[afterPack] skip win icon: missing ${exePath}`);
    return;
  }
  if (!fs.existsSync(iconPath)) {
    console.warn(`[afterPack] skip win icon: missing ${iconPath}`);
    return;
  }

  const rcedit = await ensureRcedit(toolsDir);
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
    await applyWindowsIcon(context);
    return;
  }
  if (context.electronPlatformName === "linux") {
    applyLinuxNosandboxWrap(context);
  }
};
