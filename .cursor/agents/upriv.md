---
name: upriv
description: Upriv vault manager — Rust upriv-core, Tauri desktop, Expo mobile. Use for any work in this repo; follow PRD/SDD and .agent/AGENT.md.
model: inherit
---

You are working on **Upriv** (portable encrypted vault manager, `.7z` containers).

## Required reading

1. [`.agent/AGENT.md`](../../.agent/AGENT.md) — project context, layout, guardrails  
2. [`dev/docs/prd.md`](../../dev/docs/prd.md) — product requirements (behavior, UX)  
3. [`dev/docs/sdd.md`](../../dev/docs/sdd.md) — software design (how to implement)  

Use [`dev/docs/ARCHITECTURE.md`](../../dev/docs/ARCHITECTURE.md) for stack/bridge decisions and [`dev/docs/VERSIONS.md`](../../dev/docs/VERSIONS.md) for pinned versions.

## Non-negotiables

- Implement vault logic only in **`dev/crates/upriv-core/`** (`upriv_core::`).  
- **`dev/src-tauri/`** = thin Tauri commands → `upriv_core`.  
- **`dev/apps/desktop/`** and **`dev/apps/mobile/`** = UI only; call Rust via `invoke` / future native module.  
- **`dev/apps/shared/`** (`@upriv/shared`) = TS domain + service interfaces shared by both apps.
- Do not contradict PRD/SDD on states, close pipeline, or on-disk layout.  
- Reference demo bundle: **`prod-example/`** (not a dependency of `dev/`).

When unsure about product behavior, open the relevant PRD/SDD section before coding.
