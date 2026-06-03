# Upriv — instructions for coding agents

Read **[`.agent/AGENT.md`](.agent/AGENT.md)** first for full project context (stack, layout, guardrails, commands).

**Product specs (canonical):**

- [`dev/docs/prd.md`](dev/docs/prd.md) — requirements, UX, vault states  
- [`dev/docs/sdd.md`](dev/docs/sdd.md) — design, `upriv-core`, 7z, implementation order  
- [`dev/docs/ARCHITECTURE.md`](dev/docs/ARCHITECTURE.md) — cross-platform stack and ADRs  

**Rules:** All product Rust in `dev/crates/upriv-core/`. `src-tauri/` only delegates via `#[tauri::command]`. UI is presentation-only (no crypto/disk/7z in JS). English for code/docs; UI strings via `dev/docs/i18n/`. Never commit `dev/target/` or `node_modules/`.
