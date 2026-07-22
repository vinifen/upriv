# Upriv — development workspace

Stable, pinned scaffold for desktop and mobile apps. **Desktop** ships a full mock vault UI (`dev/apps/desktop/`) with an **Electron** shell and **`upriv-daemon`** sidecar; **mobile** is an Expo scaffold only. Core Rust logic lives in `crates/upriv-core`.

## Layout

```text
dev/
├── apps/
│   ├── desktop/        # React 18 + Vite 6 + TypeScript + Tailwind 3
│   ├── electron/       # Electron main/preload + electron-builder
│   ├── mobile/         # Expo SDK 52 + React Native 0.76 (scaffold)
│   └── shared/         # @upriv/shared — domain types + service interfaces (TS only)
├── crates/
│   ├── upriv-core/     # Shared Rust API (all platforms)
│   └── upriv-daemon/   # Desktop RPC sidecar → upriv-core
├── docs/               # PRD, SDD, ARCHITECTURE, VERSIONS, i18n
├── Cargo.toml          # Rust workspace
├── .nvmrc              # Node 22.12+ (see docs/VERSIONS.md)
└── rust-toolchain.toml
```

## Prerequisites

1. **Node.js 22.12+** — `nvm use` in this folder (see `.nvmrc`)
2. **Rust 1.94.0** — `cd dev` (rustup reads `rust-toolchain.toml`) or `rustup toolchain install 1.94.0`

## Node dependencies

**No `npm install` at `dev/` root.** Desktop, Electron, and mobile are independent apps — each has its own `node_modules`:

```bash
cd dev/apps/desktop && npm install
cd dev/apps/electron && npm install
cd dev/apps/mobile && npm install    # Expo (add @upriv/shared when wired)
```

Do **not** run `npm install` in `dev/` — there is no root `node_modules`.

## Commands

```bash
cd dev
./run help                 # list all run commands
./run lint                 # all linters (Rust, tsc, eslint, prettier)
./run lint-fix             # auto-fix (rustfmt, clippy --fix, eslint --fix, prettier)
./run test                 # cargo test --workspace
./run check                # lint + test

# Same via npm:
npm run lint
npm run lint:fix
npm run test
npm run check

cargo test -p upriv-core   # Rust core only
npm run rust:lint          # Rust only: rustfmt --check + clippy
npm run rust:fix           # Rust only: apply rustfmt + clippy --fix

# Browser only (mock services)
npm run dev

# Desktop app (Electron + upriv-daemon)
npm run electron:dev

# Release build — Linux `.deb` (install) + `.AppImage` (portable)
npm run electron:build
# Same: npm run electron:build:linux

# Windows — run on a Windows host (needs `upriv-daemon.exe` + electron-builder --win)
# Produces NSIS setup + portable .exe under target/release/bundle/electron/
npm run electron:build:win
```

On Ubuntu, prefer the **`.deb`** for “download and open” (Software Install / double-click) — no FUSE and no terminal. AppImage stays for portable USB-style use when `libfuse` is available.

# Mobile (Expo Go / emulator)
npm run mobile:start
npm run mobile:android
```

## Versions

See **`docs/VERSIONS.md`**. Do not use floating `^` on Electron or React without re-validating builds.

## Product documentation

Architecture and requirements: **`docs/`** (`ARCHITECTURE.md`, `prd.md`, `sdd.md`).

## Packaging / distribution matrix

Where vault data lives (`UPRIV_DISTRIBUTION`) — **portable is only a desktop packaging mode**:

| Platform | Installed | Portable (data beside app) | Build host |
|----------|-----------|----------------------------|------------|
| **Linux** | `.deb` → `~/.local/share/upriv` | `.AppImage` (writable folder) | This Linux machine |
| **Windows** | NSIS setup → `%LOCALAPPDATA%\Upriv` | portable `.exe` (uses `PORTABLE_EXECUTABLE_DIR`) | Windows PC / Windows VM / CI |
| **macOS** | DMG → Application Support (`installed` always; never portable-beside-`.app`) | **No** | Mac only (experimental / unsigned scaffold) |
| **Android** | App sandbox / SAF (later RN) | **No** — no “USB beside APK” model; not Electron | Android toolchain later |

`custom_root` (pick any folder) still exists on desktop when the app ships; it is not the same as portable packaging.

## Linux packaging

| Artifact | Best for | Notes |
|----------|----------|--------|
| **`.deb`** | Ubuntu / Debian install | Double-click → Software Install. No FUSE. Upriv icons in hicolor (16–512) + menu entry. Data folder defaults to `~/.local/share/upriv` (install dir `/opt` is not writable). |
| **`.AppImage`** | Portable / no install | Needs **libfuse**. Sandbox wrapper only when `$APPIMAGE` is set. Data beside the `.AppImage` when that folder is writable. |

Build: `npm run electron:build` (or `electron:build:linux`).

Artifacts: `dev/target/release/bundle/electron/` — e.g. `Upriv-0.1.0-beta-linux-x64.deb`, `Upriv-0.1.0-beta-linux-x64.AppImage`.

## Windows packaging

| Artifact | Best for | Notes |
|----------|----------|--------|
| **NSIS setup** (`*-setup-*.exe`) | Installed | Program Files; data under `%LOCALAPPDATA%\Upriv` (`installed`). |
| **Portable** (`*-portable-*.exe`) | USB / no install | Data beside the exe when that folder is writable (`portable`). |

Build **on Windows** (Rust MSVC or GNU toolchain + Node): `npm run electron:build:win`.  
Cross-building Windows installers from Linux needs Wine + a Windows Rust target (`upriv-daemon.exe`) — not set up by default on this Linux workspace.

Artifacts land in the same folder: `dev/target/release/bundle/electron/`.

## macOS packaging

| Artifact | Best for | Notes |
|----------|----------|--------|
| **DMG** (experimental) | Installed | Drag to Applications; data under Application Support (`installed`). **No portable target**. **Not notarized / no hardenedRuntime** in this scaffold — Gatekeeper will block unsigned builds until signing is added. |

Build **on a Mac** only (`electron-builder --mac`). Not cross-built from Linux/Windows. Treat macOS packaging as experimental until notarization is wired.

## Android

**No portable distribution.** Future RN app uses the OS app sandbox / SAF for vault storage — not “folder beside the binary”. See PRD §3.6 / SDD §9 when that phase starts.

## Linux troubleshooting (AppImage / .deb)

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| Want no terminal / no FUSE | AppImage needs fuse | Use the **`.deb`** on Ubuntu |
| AppImage: needs FUSE | AppImage mounts via libfuse | Prefer `.deb`; or `sudo apt install libfuse2` / `libfuse2t64` |
| AppImage: `setuid_sandbox_host` / Trace/breakpoint trap under `/tmp/.mount_Upriv-*` | FUSE mount is `nosuid` → `chrome-sandbox` useless | Rebuild (wrapper disables sandbox **only when `$APPIMAGE` is set**). Old AppImages: `./Upriv-*.AppImage --no-sandbox`. `.deb` keeps chrome-sandbox. |
| AppImage won't start / sandbox error | Chromium sandbox vs AppArmor | Same as above; renderer sandbox stays on. Dev `npm run electron:dev` always uses `--no-sandbox` (dev-only). |
| `upriv-daemon not found` | Release binary missing before pack | Run `npm run daemon:build:release` or full `npm run electron:build` |
| Blank window on first `electron:dev` | Vite still compiling | Wait for port 1420 or reload once |
| FUSE / vault mount (future) | User not in `fuse` group | `sudo usermod -aG fuse $USER` then re-login — required when encrypted vault workspace mounts land in `upriv-core` |
