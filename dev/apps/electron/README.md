# Upriv — Electron shell

Spawns `upriv-daemon`, exposes `window.upriv` via preload, packages AppImage / NSIS / DMG.

Canonical product rules: [`.agent/AGENT.md`](../../../.agent/AGENT.md).

## Scripts

```bash
cd dev/apps/electron
npm install
npm run typecheck
npm run dev          # Vite :1420 + Electron (--dev)
npm run start        # production renderer path (after electron:build from dev/)
npm run dist         # electron-builder (run from dev/: npm run electron:build)
```

From `dev/`: `npm run electron:dev` / `npm run electron:build` (Linux `.deb` + AppImage).

Windows (on a Windows host): `npm run electron:build:win` → NSIS setup + portable `.exe`.  
Step-by-step (MSVC, icons, pitfalls): [`docs/WINDOWS-BUILD.md`](../../docs/WINDOWS-BUILD.md).

## Module system

| Package | `"type"` | Why |
|---------|----------|-----|
| **electron** (`apps/electron/`) | `commonjs` | Electron main/preload compile with `tsc` to `dist/*.js` — Node `require` semantics |
| **desktop** (`apps/desktop/`) | `module` | Vite 6 ESM for the React renderer |

The renderer talks to main only through **`window.upriv`** (preload bridge), not direct Node APIs.

## Dev notes

- **`npm run preview`** (desktop) serves browser `dist/` only — not the Electron bundle. Use `electron:dev` or AppImage to test the shell. Plain Chrome on `localhost:1420` has no `window.upriv` — `isElectronRenderer()` is false.
- **Debug vs release daemon:** `npm run electron:dev` builds `target/debug/upriv-daemon`; `npm run electron:build` uses `target/release/upriv-daemon`. UI version (`dev/VERSION`) is the same; only the binary profile changes. `resolveDaemonBinary()` prefers debug when present in dev.
- **Vite wait:** dev script uses `wait-on -t 30000` on port 1420; first launch may briefly show a blank window until HMR finishes — reload once if needed.
- **DevTools:** open automatically in `--dev` mode (detached). Skip with `--no-devtools` on the electron command.
- **Linux:** AppImage adds `--no-sandbox` on Chromium (AppArmor); see `dev/README.md` troubleshooting.

## Linux `--no-sandbox`

Chromium’s OS SUID sandbox often fails under AppArmor / AppImage (`setuid_sandbox_host.cc`).

- **Dev only:** `npm run dev` / `npm start` pass `--no-sandbox` on the CLI. That is **not** the production policy.
- **Packaged Linux:** `afterPack` renames the Electron binary to `*.bin` and installs a bash wrapper for **all** linux-unpacked trees (AppImage and `.deb` share that tree). The wrapper adds `--no-sandbox` **only when `$APPIMAGE` names an existing file**. `.deb` keeps the real chrome-sandbox. `main.ts` mirrors the same file check (spoofed `APPIMAGE=1` does not disable sandbox).
- **macOS DMG:** experimental scaffold — **not notarized**; Gatekeeper will reject unsigned builds until signing is added. Packaged macOS always uses `installed` (Application Support), never portable-beside-`.app`.
- **Windows portable:** Electron uses `PORTABLE_EXECUTABLE_DIR` when set so data stays beside the stable `.exe`, not under `%TEMP%` extract.
- Do **not** put `executableArgs: ["--no-sandbox"]` in `package.json` — that forced no-sandbox onto `.deb` as well.
- **Renderer** `webPreferences.sandbox: true` stays on.

**Trade-off:** AppImage disables Chromium’s OS-level sandbox so the app can start on locked-down Ubuntu; `.deb` keeps it when the kernel allows.

**Not used on Windows/macOS** packaged targets in the current `electron-builder` config.

## RPC contract

Method name constants: **`apps/desktop/src/lib/commands.ts`** (React). Execution gate: **`crates/upriv-daemon/src/rpc.rs`**. Electron main only special-cases `app_exit`.

## Layout

```text
src/
├── main.ts           # BrowserWindow, IPC allowlist, CSP (prod), prod menu + no reload
├── preload.ts        # contextBridge → window.upriv
└── daemon.ts         # stdio NDJSON ↔ upriv-daemon (env whitelist)
build/icons/          # AppImage / installer icon (not prod-example/)
```
