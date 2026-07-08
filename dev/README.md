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

# Release build (Linux AppImage)
npm run electron:build

# Mobile (Expo Go / emulator)
npm run mobile:start
npm run mobile:android
```

## Versions

See **`docs/VERSIONS.md`**. Do not use floating `^` on Electron or React without re-validating builds.

## Product documentation

Architecture and requirements: **`docs/`** (`ARCHITECTURE.md`, `prd.md`, `sdd.md`).

## Linux troubleshooting (AppImage)

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| AppImage won't start / sandbox error | Chromium sandbox vs AppArmor | AppImage uses `--no-sandbox` on the shell process (see `electron/package.json` `executableArgs`); renderer sandbox stays on |
| `upriv-daemon not found` | Release binary missing before pack | Run `npm run daemon:build:release` or full `npm run electron:build` |
| Blank window on first `electron:dev` | Vite still compiling | Wait for port 1420 or reload once |
| FUSE / vault mount (future) | User not in `fuse` group | `sudo usermod -aG fuse $USER` then re-login — required when encrypted vault workspace mounts land in `upriv-core` |
