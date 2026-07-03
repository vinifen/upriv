---
name: upriv
description: Upriv vault manager — Rust upriv-core, Electron desktop, Expo mobile. Use for any work in this repo; follow PRD/SDD and .agent/AGENT.md.
---

# Upriv agent

Read **`.agent/AGENT.md`** first for product rules, layout, and guardrails.

## Stack (quick)

- **`dev/crates/upriv-core/`** = all vault/crypto logic (`upriv_core::`)
- **`dev/crates/upriv-daemon/`** = desktop HTTP RPC → `upriv_core`
- **`dev/apps/electron/`** = Electron shell (main/preload)
- **`dev/apps/desktop/`** = React UI (presentation only)
- **`dev/apps/mobile/`** = Expo scaffold (future JNI/FFI)

## Commands

```bash
cd dev
npm run electron:dev      # desktop app
npm run dev               # browser only (mocks)
cargo test -p upriv-core
```
