---
name: upriv
description: Upriv vault manager — Rust upriv-core, Electron desktop, Expo mobile. Use for any work in this repo; follow PRD/SDD and .agent/AGENT.md.
---

# Upriv agent

Read **[`.agent/AGENT.md`](../../.agent/AGENT.md)** first — canonical product rules, layout, guardrails, **current phase**, and **`temp/` legacy reference** (research only). Do not duplicate long command lists here.

**Security ship blocker:** [`.agent/SECURITY-PLAINTEXT.md`](../../.agent/SECURITY-PLAINTEXT.md) — `encrypted_dir` must never spill decrypted vault trees to disk; do **not** port `temp/` tempfile + `export_logical_tree` close/export.

## Stack (quick)

- **`dev/crates/upriv-core/`** — vault/crypto logic (**minimal today — start here**)
- **`dev/crates/upriv-daemon/`** — desktop stdio JSON-RPC → `upriv-core`
- **`dev/apps/electron/`** — Electron shell
- **`dev/apps/desktop/`** — React UI (**mocks** until RPC wire-up)
- **`dev/apps/mobile/`** — Expo scaffold
- **`temp/upriv/`** — optional old Tauri tree (gitignored); research only — see `.agent/AGENT.md`

## Commands

See `.agent/AGENT.md` § Commands and `dev/README.md`.
