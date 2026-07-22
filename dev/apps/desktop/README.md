# Upriv — desktop UI

React web UI (Electron shell). **Presentation only** — vault logic lives in `crates/upriv-core`; `upriv-daemon` serves RPC to the UI.

## Run

```bash
cd dev/apps/desktop
npm install
npm run dev              # http://localhost:1420 (browser, mock services)
npm run preview          # browser-only preview of `dist/` — not Electron; use `npm run electron:dev`
npm run build            # typecheck + production bundle
npm run lint             # ESLint
npm run format           # Prettier (write)
npm run format:check     # Prettier (check only)
```

### Desktop app (Electron)

From `dev/`:

```bash
cd dev/apps/desktop && npm install
cd ../electron && npm install
cd ../.. && npm run electron:dev      # Vite + Electron + upriv-daemon
cd ../.. && npm run electron:build    # AppImage / installer
```

Artifacts: `dev/target/release/bundle/electron/` (`.deb` + `.AppImage` on Linux). Prefer **`.deb`** for Ubuntu (double-click install, no FUSE).

**Linux note:** on Ubuntu 23.10+ the Electron shell uses `--no-sandbox` (AppArmor blocks Chromium user namespaces). Renderer `sandbox: true` still applies. Optional: configure `chrome-sandbox` as root 4755 — see [Electron Linux docs](https://www.electronjs.org/docs/latest/tutorial/sandbox).

**MVP:** Settings + **`VaultRootGate`** (setup / repair / alias recovery) talk to live `app_settings_*` and `vault_root_*` RPCs via `platform/desktop/`. Vault list, open/close, file manager, and most other services still use **mock** data until their RPCs land (SDD §8.2.6).

## Prototype mocks (temporary)

`platform/mocks/` backs all services via `createServices()` until desktop RPC adapters exist. **Future work:** delete that folder and rename remaining `mock*` / `getMock*` / `MOCK_*` symbols to neutral platform names (details in `src/platform/mocks/README.md`).

Until real crypto is wired, unlock/close use prototype validation in `validateMockLifecyclePassword` (min 4 chars; `"wrong"` simulates failure). Hidden vault **Finance 2025** shows password hint _Q4 spreadsheet_ in the unlock modal.

## Source layout

```text
../shared/                   # @upriv/shared — domain types + service interfaces (desktop + mobile)
src/
├── main.tsx                 # Entry — mounts App, loads global styles
├── App.tsx                  # Root component (providers + vault list page)
│
├── app/                     # App shell: providers
│   └── AppProviders.tsx     # Services → AppSettings (+ I18n inside) → file manager
│
├── platform/                # Desktop-only adapters
│   ├── desktop/             # Live RPC adapters (vaultRoot, appSettings, …)
│   ├── mocks/               # Prototype data + mock services — remove when desktop RPC is wired
│   │   ├── data/            # Static fixtures (vaults, logs, settings defaults)
│   │   ├── stores/          # In-memory state (file tree, settings registry)
│   │   └── services/        # AppServices mock implementations
│   └── services/            # createServices(), ServicesProvider, hooks
│
├── features/                # Feature modules grouped by domain
│   ├── vaults/
│   │   ├── list/            # Vault list UI (header/, row/, modals/, lib/) + VaultListPage
│   │   ├── create/          # Create-vault wizard
│   │   ├── lifecycle/       # Open/close/seal (modals/, pipeline/) + VaultLifecycleLayer
│   │   ├── settings/        # VaultSettingsModal + useVaultSettings
│   │   ├── backups/         # Backup list modal
│   │   └── file-manager/    # File tree + editor (shell/, workspace/, tree/, editor/, lib/)
│   └── system/
│       ├── refresh/         # useAppRefresh — reload settings, vaults, lifecycle, file manager
│       ├── settings/        # App settings + VaultRootGate / setup / repair / alias recovery
│       ├── logs/            # App log viewer
│       └── help/            # Help modal + search
│
├── components/
│   ├── ui/                  # Reusable primitives (Button, Modal, StatusDot, …)
│   ├── icons/               # Icon component + SVG assets
│   ├── brand/               # UprivWordmark (theme prop from feature layer)
│   ├── settings/            # Shared settings form kit (sections, fields, password panel)
│   └── layout/              # AppShell, AppHeader, CenteredPanel
│
├── app/index.ts             # Re-exports AppProviders
│
├── i18n/                    # Locale loading, context, `useTranslation`
├── theme/                   # Design tokens, vault status → color/i18n mapping
├── lib/                     # shell bridge (invoke, rpc, commands) + utilities
├── hooks/                   # Shared React hooks
└── styles/                  # globals.css, CSS variables, fonts
```

### Conventions

| Rule                | Where                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| UI copy             | `dev/apps/shared/locales/*.json` via `useTranslation()` — never hardcode sentences                                 |
| Vault status colors | `theme/vault-status.ts` + CSS vars in `styles/tokens.css`                                                          |
| Desktop RPC         | `lib/commands.ts` — names match `crates/upriv-daemon`                                                              |
| Domain types        | `@upriv/shared` (`shared/`) — `VaultRow`, settings, list sort/view                                                 |
| Service layer       | `platform/services/` — factory + React context; mocks in `platform/mocks/`                                         |
| App layout          | `AppShell` + `VaultListHeader` on the vault list home screen                                                       |
| Feature UI          | `features/vaults/*` or `features/system/*`; compose `components/ui` and `components/settings`                      |
| Hook naming         | `useVault*` for vault features; `useApp*` for system-wide (`useAppSettingsContext`, `useAppLogs`, `useAppRefresh`) |
| Feature public API  | Each feature folder has one `index.ts` — see **Module boundaries (`index.ts`)** below                              |
| Import line length  | ESLint `import-newlines/enforce`: max **7** specifiers per line; `max-len` 100 cols                                |

### Module boundaries (`index.ts`)

Folder layout (when to add subfolders vs flat files): `dev/docs/ARCHITECTURE.md` §4.1.

Each feature folder under `features/vaults/*` and `features/system/*` has **one** `index.ts`. That file is the **public API** of the folder: it lists exactly what other modules may import from outside.

**Rules**

1. **Export only cross-module symbols** — if a file is imported only by siblings in the same folder (or subfolders), do **not** put it in `index.ts`.
2. **One index per feature folder** — no nested barrels (`hooks/index.ts`, …). Public symbols are listed in the parent `index.ts` when needed outside the feature.
3. **`hooks/` per feature** — custom hooks live in `<feature>/hooks/` (functions `use*` only). Types use `<feature>Types.ts` or `vaultListModalsTypes.ts` at the feature root, not inside `hooks/`. No `hooks/index.ts`.
4. **No umbrella index** — there is no `features/vaults/index.ts` or `features/system/index.ts`. Each sub-feature (`list/`, `lifecycle/`, `settings/`, …) owns its boundary.
5. **Domain types from `@upriv/shared`** — import `VaultListItem`, settings helpers, sort types, etc. from `@upriv/shared`, not re-exported through feature indexes. Feature indexes expose **UI, hooks, and desktop-only adapters** consumed elsewhere.
6. **Prefer the barrel over deep paths** — outside code imports `@/features/vaults/list`, not `@/features/vaults/list/exportVaultArchive`. If something is used outside, add it to that folder’s `index.ts` and import from there.

**Current public APIs** (maintain this table when adding exports)

| Module                 | Import path                      | Exports                                                                                                  |
| ---------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `vaults/list/`         | `@/features/vaults/list`         | `VaultListPage`, `exportVaultArchive`, `VaultListLifecycleModals`                                        |
| `vaults/lifecycle/`    | `@/features/vaults/lifecycle`    | `VaultLifecycleLayer`, `useVaultLifecycleActions`, `VaultLifecycleRequest`                               |
| `vaults/settings/`     | `@/features/vaults/settings`     | `VaultSettingsModal`                                                                                     |
| `vaults/create/`       | `@/features/vaults/create`       | `CreateVaultWizardModal`, `CreateVaultResult`                                                            |
| `vaults/backups/`      | `@/features/vaults/backups`      | `VaultBackupsModal`                                                                                      |
| `vaults/file-manager/` | `@/features/vaults/file-manager` | `FileManagerProvider`, `useFileManager`, `FileManagerLayer`                                              |
| `system/settings/`     | `@/features/system/settings`     | `AppSettingsModal`, `AppSettingsProvider`, `useAppSettingsContext`, `VaultRootGate`, bulk-export helpers |
| `system/refresh/`      | `@/features/system/refresh`      | `useAppRefresh`                                                                                          |
| `system/logs/`         | `@/features/system/logs`         | `LogsModal`                                                                                              |
| `system/help/`         | `@/features/system/help`         | `HelpModal`                                                                                              |

**When adding code**

- New component used only inside the same feature → relative import, no `index.ts` change.
- New symbol imported from another feature (e.g. `lifecycle` needs something from `list`) → export it from the source feature’s `index.ts`, import via `@/features/...`, update the table above.
- Tempted to add `hooks/index.ts` or re-export `@upriv/shared` from a feature index → don’t; it hides the real boundary and drifts out of sync (dead exports nobody imports).

## Aliases

| Alias           | Path                                                 |
| --------------- | ---------------------------------------------------- |
| `@/*`           | `src/*`                                              |
| `@upriv/shared` | `../shared/src` (includes `loadLocale`, locale JSON) |
| `@assets/*`     | `assets/*`                                           |

Versions: `../../docs/VERSIONS.md`. Product UX: `../../docs/prd.md` §3.7, `../../docs/sdd.md` §8.2.
