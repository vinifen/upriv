# Windows desktop build guide

How to produce Upriv **NSIS installer** and **portable `.exe`** on Windows (and notes for other hosts).  
Tool versions: [`VERSIONS.md`](VERSIONS.md). Packaging matrix: [`../README.md`](../README.md).

This document captures what was required to get Windows packaging working when moving from a Linux-first workspace onto a Windows build machine.

---

## What you get

| Artifact | Typical name | Role |
|----------|--------------|------|
| **NSIS setup** | `Upriv-<version>-setup-x64.exe` | Installed app (Start Menu shortcut) |
| **Portable** | `Upriv-<version>-portable-x64.exe` | Single-file run; no install |
| **Unpacked** | `win-unpacked/Upriv.exe` | Folder used to build the two above |

All land under:

```text
dev/target/release/bundle/electron/
```

Default install path (per-user NSIS):

```text
%LOCALAPPDATA%\Programs\Upriv\
```

Start Menu shortcut: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Upriv.lnk`  
App data (installed mode): under `%LOCALAPPDATA%\Upriv` (see packaging matrix in `dev/README.md`).

Builds are **unsigned** unless you add a code-signing certificate (`CSC_*` / `win.certificateFile`). Unsigned is fine for local/dev; Windows SmartScreen may warn on first run.

---

## Prerequisites (Windows host)

Install once on the machine that will run the Windows build.

| Tool | Why | Notes |
|------|-----|--------|
| **Node.js 22.12+** | Renderer + Electron + electron-builder | Match `engines` / `.nvmrc` (`22.12.0`) |
| **Rust via rustup** | `upriv-daemon.exe` | Channel pinned by `dev/rust-toolchain.toml` (e.g. **1.94.0**) |
| **VS 2022 Build Tools** (C++ / MSVC) | Link Rust `*-msvc` target | Workload: “Desktop development with C++” or Build Tools + MSVC + Windows SDK |
| **Git** | Clone / line endings | Prefer LF in this repo; Windows casing rules still apply (see below) |

Optional:

- **Windows Developer Mode** — only needed if you turn `signAndEditExecutable` back to `true` (electron-builder’s `winCodeSign` cache uses symlinks). Current packaging does **not** require it (see [Icons](#windows-icons-exe--start--taskbar)).

### MSVC environment (required for `cargo`)

`cargo build` for the MSVC toolchain needs the Visual Studio linker on `PATH`. Either:

1. Open **“x64 Native Tools Command Prompt for VS 2022”**, then `cd` into `dev/`, or  
2. From PowerShell / cmd, load vcvars then build:

```bat
"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
cd /d C:\path\to\upriv\dev
npm run electron:build:win
```

Community/Professional layouts use the same `vcvars64.bat` under `...\2022\Community\...` or `...\2022\Professional\...`.

Without vcvars you often see linker errors (`link.exe` not found) when building `upriv-daemon`.

---

## One-time dependency install

```bat
cd C:\path\to\upriv\dev\apps\desktop
npm install

cd ..\electron
npm install
```

Rust crates resolve on first `cargo` / `npm run daemon:build:release` (no separate Cargo install at `dev/` root beyond rustup).

---

## Build command (happy path)

From `dev/` **after** MSVC env is loaded:

```bat
cd C:\path\to\upriv\dev
npm run electron:build:win
```

That script runs, in order:

1. `node scripts/sync-version.mjs` — sync `dev/VERSION` into manifests  
2. `npm run build:electron --prefix apps/desktop` — typecheck + Vite Electron renderer → `apps/desktop/renderer-out/`  
3. `npm run daemon:build:release` — `cargo build --release -p upriv-daemon` → `target/release/upriv-daemon.exe`  
4. `npm run dist:win --prefix apps/electron` — compile Electron main (`tsc`) + `electron-builder --win nsis portable`

Rebuild **packaging only** (renderer + daemon already fresh):

```bat
cd apps\electron
npm run dist:win
```

---

## Pipeline details (what each piece does)

```text
dev/VERSION
    │ sync-version
    ▼
apps/desktop  ──build:electron──►  renderer-out/     (React UI for Electron)
apps/.../upriv-daemon ──release──► target/release/upriv-daemon.exe
apps/electron ──tsc──► dist/main.js + preload
         │
         └─ electron-builder
               • packs renderer + main into win-unpacked/
               • extraResources: daemon → resources/bin/
               • extraResources: icons → resources/icons/
               • afterPack: embed icon.ico into Upriv.exe (rcedit)
               • NSIS setup + portable wrappers
```

Relevant config lives in `apps/electron/package.json` → `"build"`.

---

## Windows-specific fixes already in the repo

These were required to make Windows builds reliable. Do **not** regress them when changing scripts.

### 1. Cross-platform renderer build (`ELECTRON=true`)

Unix-style `ELECTRON=true vite build` fails under `cmd.exe`.

**Fix:** `apps/desktop/scripts/build-electron.mjs` sets `process.env.ELECTRON` and invokes `tsc` / Vite.  
`apps/desktop` script: `"build:electron": "node ./scripts/build-electron.mjs"`.

### 2. Case-sensitive path clash (`App.tsx` vs `app/`)

On Linux, `src/App.tsx` and `src/app/` can coexist. On Windows (case-insensitive FS) that layout breaks checkout/build.

**Fix:** root component is `src/RootApp.tsx` (imported from `main.tsx`). Keep that naming.

### 3. `signAndEditExecutable: false`

electron-builder’s default Windows path downloads **winCodeSign**, whose cache extract creates **symlinks**. Without Developer Mode / elevation that fails, and packaging aborts.

**Current config:** `"win": { "signAndEditExecutable": false, ... }` — skips signing **and** electron-builder’s built-in rcedit pass.

**Trade-off:** without a follow-up step, `Upriv.exe` would keep the default **Electron atom** icon in Explorer / Start / taskbar.

### 4. Icon embed via `afterPack` + standalone rcedit

**Fix:** `apps/electron/scripts/afterPack.cjs`:

- On **win32**, downloads (once) `build/tools/rcedit-x64.exe` (gitignored) and runs  
  `rcedit Upriv.exe --set-icon build/icons/icon.ico`
- On **linux**, keeps the AppImage `--no-sandbox` wrapper behavior (same file, platform branch)

Executable name resolution uses `productFilename` (not only `packager.executableName`, which can be unset on Windows).

Also:

- `win.icon` / NSIS `installerIcon` / `uninstallerIcon` → `build/icons/icon.ico`
- `extraResources` copies `icon.ico` + `icon.png` into `resources/icons/` for runtime
- `main.ts`: `BrowserWindow` icon, `app.setAppUserModelId("com.upriv.desktop")`, and `setAppDetails` / `setIcon` so the **running** taskbar entry uses Upriv branding

Master assets and regen notes: `apps/electron/build/icons/README.md`.  
`icon.ico` is a multi-size ICO generated from the PNGs (e.g. via `png-to-ico`); commit the `.ico` when brand assets change.

---

## Windows icons (exe / Start / taskbar)

| Surface | What supplies the icon |
|---------|-------------------------|
| Explorer / Start search / `.lnk` | Resources **inside** `Upriv.exe` (afterPack rcedit) + shortcut `IconLocation=...\Upriv.exe,0` |
| Window title / taskbar while running | `BrowserWindow` icon + `setAppDetails` from `resources/icons/` |
| NSIS setup UI | `nsis.installerIcon` etc. |

### Stale atom icon after a rebuild

Windows and Start Search **cache** icons aggressively. If you still see the Electron atom:

1. Confirm you are running the **new** install (`%LOCALAPPDATA%\Programs\Upriv\Upriv.exe` mtime / size).  
2. Reinstall with the new `*-setup-x64.exe` (or replace files from `win-unpacked`).  
3. Unpin any old taskbar pin; open the app again from Start.  
4. If Start Search still shows the atom: sign out / reboot, or refresh the shell (`ie4uinit.exe -show`, or restart Explorer).

Silent reinstall (current-user NSIS):

```bat
Upriv-<version>-setup-x64.exe /S
```

---

## Other environments

### Linux workspace (default for day-to-day)

Use Linux packaging:

```bash
cd dev
npm run electron:build        # or electron:build:linux
```

Produces `.deb` + `.AppImage`. **Do not expect** `electron:build:win` to work out of the box here.

Cross-building Windows from Linux would need roughly:

- Wine (or a Windows CI runner) for electron-builder `--win`
- Rust target `x86_64-pc-windows-gnu` or `x86_64-pc-windows-msvc` + matching linker
- Still run afterPack/rcedit semantics for icons

That path is **not** set up in this repo by default. Prefer a **Windows PC, Windows VM, or Windows CI job**.

### Windows VM / CI

Same prerequisites as a physical Windows host. In CI:

1. Use an image with Node 22 + rustup + VS Build Tools (or `ilammy/msvc-dev-cmd` / equivalent).  
2. `npm ci` in `apps/desktop` and `apps/electron`.  
3. Run `npm run electron:build:win` from `dev/` with MSVC env.  
4. Upload `target/release/bundle/electron/*-setup-*.exe` and `*-portable-*.exe` as artifacts.  
5. First CI run will download Electron + rcedit into caches; allow network.

### macOS

DMG only, **on a Mac** (`electron-builder --mac`). Not produced by `electron:build:win`. See `dev/README.md` → macOS packaging (unsigned / experimental).

---

## Checklist for the next Windows build

- [ ] Node 22.12+, rustup toolchain, VS Build Tools installed  
- [ ] `vcvars64` / x64 Native Tools shell active  
- [ ] `npm install` in `apps/desktop` and `apps/electron`  
- [ ] `cd dev` → `npm run electron:build:win`  
- [ ] Confirm log line: `[afterPack] embedded Windows icon into Upriv.exe`  
- [ ] Artifacts under `dev/target/release/bundle/electron/`  
- [ ] Reinstall or replace previous install before judging Start / taskbar icons  
- [ ] (Optional) Clear pin / refresh icon cache if branding looks stale  

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| `link.exe` / LNK errors building daemon | MSVC env not loaded | Run vcvars / Native Tools prompt |
| `ELECTRON=true` / vite fails under cmd | Old Unix-only script | Use `build-electron.mjs` (already wired) |
| Case conflict `App` / `app` | File vs folder on Windows FS | Keep `RootApp.tsx`; don’t reintroduce `App.tsx` next to `app/` |
| electron-builder fails extracting winCodeSign / symlink | `signAndEditExecutable: true` without Developer Mode | Keep `false`; rely on afterPack rcedit |
| Atom icon in Explorer / Start | Icon not embedded, or **old install** | Ensure afterPack ran; reinstall new setup; clear icon cache |
| Atom in taskbar only while running | Runtime icon path missing | Confirm `resources/icons/icon.ico` in install; check `main.ts` icon resolution |
| `upriv-daemon not found` at runtime | Daemon missing from pack | Full `electron:build:win` so release `upriv-daemon.exe` exists before pack |
| Portable data in wrong place | Expected beside exe | Portable sets `PORTABLE_EXECUTABLE_DIR`; keep the exe on a writable folder |
| SmartScreen warning | Unsigned binary | Expected without cert; optional future signing |

---

## Related files

| Path | Role |
|------|------|
| `dev/package.json` → `electron:build:win` | Orchestrates sync + renderer + daemon + dist |
| `dev/apps/desktop/scripts/build-electron.mjs` | Cross-platform Electron renderer build |
| `dev/apps/electron/package.json` → `"build"` | electron-builder targets, icons, `signAndEditExecutable` |
| `dev/apps/electron/scripts/afterPack.cjs` | Windows icon embed + Linux AppImage wrap |
| `dev/apps/electron/build/icons/` | PNG/ICO brand assets |
| `dev/apps/electron/src/main.ts` | Window icon, AppUserModelId, setAppDetails |
| `dev/.gitignore` | Ignores `apps/electron/build/tools/` (downloaded rcedit) |
