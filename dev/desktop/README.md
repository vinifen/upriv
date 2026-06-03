# Upriv — desktop UI (scaffold)

React web UI only. Business logic belongs in Rust (`crates/upriv-core`; `src-tauri` delegates).

## Run

```bash
cd dev/desktop
npm install
npm run dev              # http://localhost:1420
npm run tauri -- dev     # Tauri + WebView
```

## Structure

| Path | Role |
|------|------|
| `src/` | React entry (`App.tsx`, `main.tsx`) |
| `assets/` | Brand assets (copy from bundle when needed) |
| `../docs/i18n/` | UI strings (keys only) |
| `../src-tauri/` | Tauri shell (not inside `desktop/`) |

Versions: `../docs/VERSIONS.md`.
