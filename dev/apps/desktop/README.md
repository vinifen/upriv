# Upriv — desktop UI

React web UI (Tauri shell). **Presentation only** — vault logic lives in `crates/upriv-core`; `src-tauri` delegates via `invoke`.

## Run

```bash
cd dev/apps/desktop
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
├── features/                # Feature modules grouped by domain
│   ├── vaults/
│   │   ├── list/            # Vault list UI + VaultListPage compositor; hooks/
│   │   ├── create/          # Create-vault wizard
│   │   ├── lifecycle/       # Open/close/seal, recovery, pipeline overlays
│   │   ├── settings/        # VaultSettingsModal + useVaultSettings
│   │   ├── backups/         # Backup list modal
│   │   └── file-manager/    # In-vault file tree + editor
│   └── system/
│       ├── refresh/         # useAppRefresh — reload settings, vaults, lifecycle, file manager
│       ├── settings/        # App settings modal + context
│       ├── logs/            # App log viewer
│       └── help/            # Help modal + search
│
├── components/
│   ├── ui/                  # Reusable primitives (Button, Modal, StatusDot, …)
│   ├── settings/            # Shared settings form kit (sections, fields, password panel)
│   └── layout/              # AppShell, AppHeader, CenteredPanel
│
├── i18n/                    # Locale loading, context, `useTranslation`
├── theme/                   # Design tokens, vault status → color/i18n mapping
├── constants/               # Product limits (name length, note max, …)
├── lib/tauri/               # `invoke` wrapper + command name constants
├── hooks/                   # Shared React hooks
└── styles/                  # globals.css, CSS variables, fonts
```

### Conventions

| Rule                | Where                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- |
| UI copy             | `dev/docs/i18n/*.json` via `useTranslation()` — never hardcode sentences                      |
| Vault status colors | `theme/vault-status.ts` + CSS vars in `styles/tokens.css`                                     |
| Tauri commands      | `lib/tauri/commands.ts` — names match `src-tauri`                                             |
| Domain types        | `@upriv/shared` (`shared/`) — `VaultRow`, settings, list sort/view                            |
| Service layer       | `platform/services/` — factory + React context; mocks in `platform/mocks/`                    |
| App layout          | `AppShell` + `VaultListHeader` on the vault list home screen                                  |
| Feature UI          | `features/vaults/*` or `features/system/*`; compose `components/ui` and `components/settings` |
| Feature public API  | Each feature folder has one `index.ts` — see **Module boundaries (`index.ts`)** below         |
| Import line length  | ESLint `import-newlines/enforce`: max **4** specifiers per line; `max-len` 100 cols           |

### Module boundaries (`index.ts`)

Each feature folder under `features/vaults/*` and `features/system/*` has **one** `index.ts`. That file is the **public API** of the folder: it lists exactly what other modules may import from outside.

**Rules**

1. **Export only cross-module symbols** — if a file is imported only by siblings in the same folder (or subfolders), do **not** put it in `index.ts`. Use relative imports internally (`./VaultRow`, `../useVaultListState`, `./hooks/useVaultListScreen`).
2. **One index per feature folder** — no nested barrels (`hooks/index.ts`, …). Public symbols are listed in the parent `index.ts` when needed outside the feature.
3. **`hooks/` per feature** — custom hooks live in `<feature>/hooks/` (functions `use*` only). Types use `<feature>Types.ts` or `vaultListModalsTypes.ts` at the feature root, not inside `hooks/`. No `hooks/index.ts`.
4. **No umbrella index** — there is no `features/vaults/index.ts` or `features/system/index.ts`. Each sub-feature (`list/`, `lifecycle/`, `settings/`, …) owns its boundary.
5. **Domain types from `@upriv/shared`** — import `VaultListItem`, settings helpers, sort types, etc. from `@upriv/shared`, not re-exported through feature indexes. Feature indexes expose **UI, hooks, and desktop-only adapters** consumed elsewhere.
6. **Prefer the barrel over deep paths** — outside code imports `@/features/vaults/list`, not `@/features/vaults/list/exportVaultArchive`. If something is used outside, add it to that folder’s `index.ts` and import from there.

**How to read a feature**

```text
features/vaults/list/
├── index.ts              ← “what leaves this folder”
├── VaultList.tsx         ← UI (relative imports only)
├── VaultListPage.tsx       ← home page compositor
├── hooks/                ← useVaultListState, useVaultListScreen, …
├── vaultListModalsTypes.ts
└── exportVaultArchive.ts
```

**Current public APIs** (maintain this table when adding exports)

| Module                 | Import path                      | Exports                                                                                                    |
| ---------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `vaults/list/`         | `@/features/vaults/list`         | `VaultListPage`, `exportVaultArchive`, `VaultListLifecycleModals`                                          |
| `vaults/lifecycle/`    | `@/features/vaults/lifecycle`    | `VaultLifecycleLayer`, `useVaultLifecycleActions`, `VaultLifecycleRequest`                                 |
| `vaults/settings/`     | `@/features/vaults/settings`     | `VaultSettingsModal`                                                                                       |
| `vaults/create/`       | `@/features/vaults/create`       | `CreateVaultWizardModal`, `CreateVaultResult`                                                              |
| `vaults/backups/`      | `@/features/vaults/backups`      | `VaultBackupsModal`                                                                                        |
| `vaults/file-manager/` | `@/features/vaults/file-manager` | `FileManagerProvider`, `useFileManager`, `FileManagerLayer`                                                |
| `system/settings/`     | `@/features/system/settings`     | `AppSettingsModal`, `AppSettingsProvider`, `useAppSettingsContext`, bulk-export helpers used by vault list |
| `system/refresh/`      | `@/features/system/refresh`      | `useAppRefresh`                                                                                            |
| `system/logs/`         | `@/features/system/logs`         | `LogsModal`                                                                                                |
| `system/help/`         | `@/features/system/help`         | `HelpModal`                                                                                                |

**When adding code**

- New component used only inside the same feature → relative import, no `index.ts` change.
- New symbol imported from another feature (e.g. `lifecycle` needs something from `list`) → export it from the source feature’s `index.ts`, import via `@/features/...`, update the table above.
- Tempted to add `hooks/index.ts` or re-export `@upriv/shared` from a feature index → don’t; it hides the real boundary and drifts out of sync (dead exports nobody imports).

## Aliases

| Alias       | Path                |
| ----------- | ------------------- |
| `@/*`       | `src/*`             |
| `@i18n/*`   | `../../docs/i18n/*` |
| `@assets/*` | `assets/*`          |

Versions: `../../docs/VERSIONS.md`. Product UX: `../../docs/prd.md` §3.7, `../../docs/sdd.md` §8.2.
