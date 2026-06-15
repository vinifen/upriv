# Prototype mocks (desktop only)

**Temporary.** Everything under this folder must be removed once real platform services
(Tauri + `upriv-core`) replace mocks in `createServices()`. That includes `data/`,
`stores/`, `services/`, and any feature imports of mock-only helpers (lifecycle password
validation, archive bytes, folder picker paths, etc.).

**Rename before production.** Many symbols here still use `mock` / `Mock` / `getMock*` in
names (`mockServices`, `getMockVaultSettings`, `MOCK_VAULTS`, `validateMockLifecyclePassword`, …).
When wiring Tauri, drop the folder and/or rename to neutral names (`createServices` exports,
platform adapters, internal helpers). Do not leak `mock` into `@upriv/shared` or feature code.

Delete this folder when Tauri services replace mocks in `createServices()`.

| Folder      | Role                                                                        |
| ----------- | --------------------------------------------------------------------------- |
| `data/`     | Static fixtures — vault rows, log files, backup lists, default app settings |
| `stores/`   | Mutable in-memory state — settings registry, file tree sessions             |
| `services/` | `AppServices` mock implementations                                          |

Entry point: `index.ts` exports **`mockServices` only**. Import mock data/stores/services via relative paths inside this folder — do not re-export store primitives from the barrel.

Features should use hooks from `@/platform/services`, not import mocks directly. Exceptions: UI-only demo paths (e.g. mock folder picker in app settings form).
