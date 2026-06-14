# Upriv — design baseline (Stitch)

This folder holds the **starting-point design direction** for the Upriv vault manager UI. It is **not** the final, shipped interface.

## Status

| | |
|---|---|
| **Purpose** | Visual and interaction **reference** — mood, layout, tokens, component ideas |
| **Not** | Production UI, implementation spec, or approved final design |
| **Authority for behavior** | `dev/docs/prd.md` (§3.7.0–3.7), `dev/docs/sdd.md` (§8.2.0–8.2), `dev/docs/i18n/` |

Treat everything here as **exploratory**. Colors, copy, spacing, and flows may change before implementation. Engineers and designers should align with PRD/SDD and i18n keys; use this folder only as **inspiration and a shared baseline**.

## Contents

| File | Role |
|------|------|
| **`code.html`** | Static HTML prototype (Tailwind) — vault list, row states, modals sketch. Open in a browser for a quick visual preview. **Not** wired to Tauri or upriv-core. |
| **`DESIGN.md`** | Design system notes extracted from the prototype: palette, typography, spacing, component patterns (“Calm Security”). |
| **`screen.png`** | Screenshot of the prototype (when present) — same non-final reference as `code.html`. |

## How to use this folder

1. **Designers** — iterate from this baseline toward final mockups; do not assume `code.html` matches every PRD requirement (e.g. i18n keys, Close vs Seal copy, confirm-by-typing flows).
2. **Implementers** — do **not** copy `code.html` verbatim into the app; implement against PRD/SDD + locale files and replace hardcoded strings with i18n keys per `dev/docs/LOCALE.md`.
3. **Reviewers** — compare proposals against this baseline **and** against `dev/docs/prd.md` §3.7; gaps in the prototype are expected.

## Related docs

- Product UX requirements: `dev/docs/prd.md` §3.7.0 (baseline note) · §3.7
- UI specification & tokens (engineering): `dev/docs/sdd.md` §8.2.0 (baseline note) · §8.2
- UI strings (mandatory for shipped UI): `dev/docs/i18n/en.json`, `pt-BR.json`
- Brand assets (dev): `dev/apps/desktop/assets/`
