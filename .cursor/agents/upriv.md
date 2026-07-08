---
name: upriv
description: Upriv vault manager — Rust upriv-core, Electron desktop, Expo mobile. Use for any work in this repo; follow PRD/SDD and .agent/AGENT.md.
---

# Upriv agent

Read **[`.agent/AGENT.md`](../../.agent/AGENT.md)** first — canonical product rules, layout, guardrails, and desktop shell mindset. Do not duplicate long command lists here.

## Stack (quick)

- **`dev/crates/upriv-core/`** — vault/crypto logic
- **`dev/crates/upriv-daemon/`** — desktop stdio JSON-RPC → `upriv-core`
- **`dev/apps/electron/`** — Electron shell
- **`dev/apps/desktop/`** — React UI
- **`dev/apps/mobile/`** — Expo scaffold

## Commands

See `.agent/AGENT.md` § Commands and `dev/README.md`.
