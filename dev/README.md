# Upriv — development workspace

Stable, pinned scaffold for the desktop app. **No product features** — only tooling and layout. Builds verified on Linux (2026-05-31).

## Layout

```text
dev/
├── crates/upriv-core/  # Shared Rust API (all platforms)
├── desktop/            # React 18 + Vite 6 + TypeScript + Tailwind 3
├── src-tauri/          # Tauri 2.11 shell → upriv-core
├── mobile/             # Expo SDK 52 + React Native 0.76 (scaffold)
├── docs/               # PRD, SDD, ARCHITECTURE, VERSIONS, i18n
├── Cargo.toml          # Rust workspace
├── .nvmrc              # Node 22.12+ (see docs/VERSIONS.md)
└── rust-toolchain.toml
```

## Prerequisites

1. **Node.js 22.12+** — `nvm use` in this folder (see `.nvmrc`)
2. **Rust 1.94.0** — `cd dev` (rustup reads `rust-toolchain.toml`) or `rustup toolchain install 1.94.0`
3. **Linux:** [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/) (`libwebkit2gtk-4.1-dev`, …)

## Commands

```bash
cd dev
npm install --prefix desktop
cargo test -p upriv-core   # Rust core only

# Browser only
npm run dev

# Desktop shell
npm run tauri:dev

# Release build (Linux)
npm run tauri:build

# Mobile (Expo Go / emulator)
npm run mobile:start
npm run mobile:android
```

## Versions

See **`docs/VERSIONS.md`**. Do not use floating `^` on Tauri or React without re-validating builds.

## Product documentation

Architecture and requirements: **`docs/`** (`ARCHITECTURE.md`, `prd.md`, `sdd.md`).
