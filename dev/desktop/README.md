# Upriv — desktop UI

React web UI (Tauri shell). **Presentation only** — vault logic lives in `crates/upriv-core`; `src-tauri` delegates via `invoke`.

## Run

```bash
cd dev/desktop
npm install
npm run dev              # http://localhost:1420 (browser)
npm run tauri -- dev     # Tauri + WebView
npm run build            # typecheck + production bundle
npm run lint             # ESLint
npm run format           # Prettier (write)
npm run format:check     # Prettier (check only)
```

## Mock demo passwords (prototype only)

Until Tauri wires real crypto, unlock/close modals accept **any non-empty password** except the literal `wrong` (used to simulate failure in the change-password panel). Vaults that start **open** in `MOCK_VAULTS` are pre-seeded with `demo`. Hidden vault **Finance 2025** shows password hint _Q4 spreadsheet_ in the unlock modal (from `mockVaultSettings`).

## Source layout

```text
../shared/                   # @upriv/shared — domain types + service interfaces (desktop + mobile)
src/
├── main.tsx                 # Entry — mounts App, loads global styles
├── App.tsx                  # Root component (providers + home screen)
│
├── app/                     # App shell: providers, top-level screens
│   ├── AppProviders.tsx     # Services, app settings, i18n, file manager
│   └── HomeScreen.tsx       # Home / vault list route
│
├── platform/                # Desktop-only adapters
│   ├── mocks/               # Prototype data + mock services (delete with Tauri)
│   │   ├── data/            # Static fixtures (vaults, logs, settings defaults)
│   │   ├── stores/          # In-memory state (file tree, settings registry)
│   │   └── services/        # AppServices mock implementations
│   └── services/            # createServices(), ServicesProvider, hooks
│
├── features/                # Feature modules (one folder per flow)
│   ├── vault-list/          # List UI + hooks (useVaultListScreen orchestrates the page)
│   ├── vault-lifecycle/     # Open/close/seal, recovery, pipeline overlays
│   ├── vault-settings/      # Vault config.toml forms + VaultSettingsModal
│   ├── vault-backups/       # Backup list modal + mock backup data
│   ├── file-manager/, vault-create/, app-settings/, logs/, help/
│
├── components/
│   ├── ui/                  # Reusable primitives (Button, Modal, StatusDot, …)
│   └── layout/              # AppShell, AppHeader, CenteredPanel
│
├── i18n/                    # Locale loading, context, `useTranslation`
├── theme/                   # Design tokens, vault status → color/i18n mapping
├── types/                   # Re-exports from @upriv/shared (migration shim)
├── constants/               # Product limits (name length, note max, …)
├── lib/tauri/               # `invoke` wrapper + command name constants
├── hooks/                   # Shared React hooks
└── styles/                  # globals.css, CSS variables, fonts
```

### Conventions

| Rule                | Where                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| UI copy             | `dev/docs/i18n/*.json` via `useTranslation()` — never hardcode sentences |
| Vault status colors | `theme/vault-status.ts` + CSS vars in `styles/tokens.css`                |
| Tauri commands      | `lib/tauri/commands.ts` — names match `src-tauri`                        |
| Domain types        | `@upriv/shared` (`shared/`) — `VaultRow`, settings, list sort/view |
| Service layer       | `platform/services/` — factory + React context; mocks in `platform/mocks/` |
| App layout          | `AppShell` + `VaultListHeader` on the vault list home screen               |
| Feature UI          | `features/<name>/` — screen + local hooks; compose `components/ui`       |

## Aliases

| Alias       | Path             |
| ----------- | ---------------- |
| `@/*`       | `src/*`          |
| `@i18n/*`   | `../docs/i18n/*` |
| `@assets/*` | `assets/*`       |

Versions: `../docs/VERSIONS.md`. Product UX: `../docs/prd.md` §3.7, `../docs/sdd.md` §8.2.
