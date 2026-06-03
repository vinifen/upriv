# Upriv — desktop UI

React web UI (Tauri shell). **Presentation only** — vault logic lives in `crates/upriv-core`; `src-tauri` delegates via `invoke`.

## Run

```bash
cd dev/desktop
npm install
npm run dev              # http://localhost:1420 (browser)
npm run tauri -- dev     # Tauri + WebView
npm run build            # typecheck + production bundle
```

## Source layout

```text
src/
├── main.tsx                 # Entry — mounts App, loads global styles
├── App.tsx                  # Root component (providers + home screen)
│
├── app/                     # App shell: providers, top-level screens
│   ├── AppProviders.tsx     # i18n and future global context
│   └── HomeScreen.tsx       # Home / vault list route (placeholder)
│
├── features/                # Feature modules (one folder per flow)
│   └── (vault-list, unlock, … — add as screens are built)
│
├── components/
│   ├── ui/                  # Reusable primitives (Button, Modal, StatusDot, …)
│   └── layout/              # AppShell, AppHeader, CenteredPanel
│
├── i18n/                    # Locale loading, context, `useTranslation`
├── theme/                   # Design tokens, vault status → color/i18n mapping
├── types/                   # Shared TS types (VaultRow, statuses, …)
├── constants/               # Product limits (name length, note max, …)
├── lib/tauri/               # `invoke` wrapper + command name constants
├── hooks/                   # Shared React hooks
└── styles/                  # globals.css, CSS variables, fonts
```

### Conventions

| Rule | Where |
|------|--------|
| UI copy | `dev/docs/i18n/*.json` via `useTranslation()` — never hardcode sentences |
| Vault status colors | `theme/vault-status.ts` + CSS vars in `styles/tokens.css` |
| Tauri commands | `lib/tauri/commands.ts` — names match `src-tauri` |
| Domain types | `types/` — align with SDD DTOs (`VaultRow`, …) |
| Feature UI | `features/<name>/` — screen + local hooks; compose `components/ui` |

## Aliases

| Alias | Path |
|-------|------|
| `@/*` | `src/*` |
| `@i18n/*` | `../docs/i18n/*` |
| `@assets/*` | `assets/*` |

Versions: `../docs/VERSIONS.md`. Product UX: `../docs/prd.md` §3.7, `../docs/sdd.md` §8.2.
