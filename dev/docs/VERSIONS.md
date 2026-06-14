# Pinned toolchain — `dev/` (stability-first)

**Policy:** exact versions in `package.json` / `Cargo.toml`; refresh only after testing desktop (`npm run build`, `npm run tauri -- build`) and mobile (`npm run typecheck`, `expo start`). Product specs: `dev/docs/` (`prd.md`, `sdd.md`, `ARCHITECTURE.md`).

**Last reviewed:** 2026-06-01 (Rust pin)

## System

| Tool | Version | Notes |
|------|---------|--------|
| Node.js | **22.12+** (`.nvmrc`: `22.12.0`) | Matches `engines` in `mobile/package.json` and [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) |
| Rust | **1.94.0** (`rust-toolchain.toml`) | `rustup` installs this channel in `dev/`; Tauri 2.11 MSRV ≥ 1.77.2 |
| Linux deps | webkit2gtk-4.1, build-essential, … | See Tauri prerequisites |

## Desktop — JavaScript (`dev/apps/desktop/`)

| Package | Version | Role |
|---------|---------|------|
| `react` / `react-dom` | **18.3.1** | UI (LTS ecosystem; avoids React 19 churn) |
| `vite` | **6.3.5** | Bundler (mature line; not Vite 7) |
| `@vitejs/plugin-react` | **4.4.1** | React + Fast Refresh for Vite 6 |
| `typescript` | **5.7.3** | Type-check |
| `tailwindcss` | **3.4.17** | Styling (v3 = long-term docs/tooling) |
| `postcss` | **8.4.49** | CSS pipeline |
| `autoprefixer` | **10.4.21** | CSS pipeline |
| `@tauri-apps/api` | **2.11.0** | Latest npm publish for the 2.11 line (no `2.11.1`/`2.11.2` on npm) |
| `@tauri-apps/cli` | **2.11.2** | Build/dev CLI (can be patch ahead of `api`) |

## Desktop — Rust (`dev/src-tauri/`)

| Crate | Version | Role |
|-------|---------|------|
| `tauri` | **=2.11.2** | Shell |
| `tauri-build` | **=2.6.2** | Build script (pairs with Tauri 2.11) |

No app plugins in the base scaffold (add `tauri-plugin-opener` etc. when needed, pinned to the same Tauri minor).

## Mobile — JavaScript (`dev/apps/mobile/`)

| Package | Version | Role |
|---------|---------|------|
| `expo` | **52.0.49** | SDK (mature line; last 52.x patch) |
| `react` | **18.3.1** | Same major as desktop |
| `react-native` | **0.76.9** | Default RN for Expo SDK 52 |
| `expo-status-bar` | **2.0.1** | Status bar API |
| `react-native-safe-area-context` | **4.12.0** | Safe areas |
| `react-native-screens` | **4.4.0** | Native screen primitives |
| `typescript` | **5.7.3** | Same as desktop |
| `@types/react` | **18.3.18** | Types for React 18 |
| `babel-preset-expo` | **12.0.12** | Matches SDK 52 |
| `@babel/core` | **7.26.10** | Babel |

**Expo config:** `newArchEnabled: false` in `app.json` until `upriv-core` native module is tested on New Architecture.

**Not used:** Tauri Android (product ADR), Expo SDK 53+ / RN 0.79 / React 19 on mobile (kept for a later coordinated upgrade with desktop).

## Future (not in scaffold)

| Stack | Suggested pin | When |
|-------|---------------|------|
| `upriv-core` (Rust) | `argon2` 0.5, `zeroize` 1.8, … | `crates/upriv-core/` + `mobile/src/native/` |
| `expo-dev-client` | SDK 52 line | Before JNI / UniFFI bridge |
| `7zz` | 24.09+ ARM64 | APK `jniLibs` |

## Why not “latest”?

| Choice | Rationale |
|--------|-----------|
| Tauri **2.11.x** (`api` 2.11.0, `cli`/crate 2.11.2) | Official releases: npm `api` stops at 2.11.0; `cli` and Rust crate ship 2.11.2 — same **minor**, safe together |
| Tauri **2.11** vs 2.10.x | 2.10.x can pull mismatched `tauri-runtime` on fresh `cargo build` |
| React **18** not 19 | Broader library compatibility for a long-lived product |
| Vite **6** not 7 | `@vitejs/plugin-react` 4.x targets Vite 4–6; v6 drops Vite 7 |
| Tailwind **3** not 4 | Stable PostCSS workflow; upgrade to v4 when UI work starts |
| Expo **52** + RN **0.76** | Matches React **18** desktop; SDK 53/RN 0.79 deferred |
| `newArchEnabled: false` | Safer until custom Rust native code lands |
