# Prototype mocks (temporary)

Desktop adapters in [`../desktop/`](../desktop/) + `upriv-daemon` + `upriv-core` replace mocks in
`createServices()`. That includes `data/`, `stores/`, and `services/` under this folder.

When wiring desktop RPC, drop this folder and/or rename to neutral names (`createServices` exports,
service interfaces in `@upriv/shared`).

| Folder      | Role                                                                        |
| ----------- | --------------------------------------------------------------------------- |
| `data/`     | Static fixtures — vault rows, log files, backup lists, default app settings |
| `stores/`   | Mutable in-memory state — settings registry, file tree sessions             |
| `services/` | `AppServices` mock implementations                                          |

Entry point: `index.ts` exports **`mockServices` only**. Import mock data/stores/services via relative paths inside this folder — do not re-export store primitives from the barrel.

Features should use hooks from `@/platform/services`, not import mocks directly.

Delete this folder when desktop services replace mocks in `createServices()`.
