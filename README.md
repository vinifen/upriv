# Upriv

**Upriv** — portable encrypted vault manager (universal `.7z` containers). Product docs and reference demo bundle.

## Language

| Scope | Language |
|-------|----------|
| Docs, config, code, logs, bundles | **English** |
| App UI | **i18n keys** → `dev/docs/i18n/en.json`, `dev/docs/i18n/pt-BR.json` |

See **`dev/docs/LOCALE.md`** for the full policy.

## Repository layout

| Path | Purpose |
|------|---------|
| **`dev/apps/desktop/`** | **Desktop UI** — React web (v0.1); see `dev/apps/desktop/README.md` |
| **`dev/src-tauri/`** | **Desktop shell** — Tauri 2 + Rust commands |
| **`dev/apps/mobile/`** | **Mobile UI** — React Native (future) |
| **`dev/apps/shared/`** | **@upriv/shared** — TS domain types + service interfaces (desktop + mobile) |
| **`dev/docs/`** | PRD, SDD, **`ARCHITECTURE.md`**, `LOCALE.md`, `i18n/` |
| **`dev/crates/upriv-core/`** | **Shared Rust core** (`upriv_core` library) |
| **`dev/docs/stitch_upriv_vault_manager/`** | **Design baseline only** (Stitch prototype + tokens) — not the final UI |

**Stack:** desktop = React 18 + Vite 6 + Tauri 2.11 + Rust; mobile = Expo SDK 52 + RN 0.76. Pinned versions: **`dev/docs/VERSIONS.md`**.

**Start here:** `dev/README.md` · `dev/docs/prd.md` · `dev/docs/sdd.md` · `dev/docs/ARCHITECTURE.md`  
**AI agents:** `.agent/AGENT.md`
