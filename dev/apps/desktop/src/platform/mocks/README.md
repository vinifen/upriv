# Prototype mocks (desktop only)

Delete this folder when Tauri services replace mocks in `createServices()`.

| Folder      | Role                                                                        |
| ----------- | --------------------------------------------------------------------------- |
| `data/`     | Static fixtures — vault rows, log files, backup lists, default app settings |
| `stores/`   | Mutable in-memory state — settings registry, file tree sessions             |
| `services/` | `AppServices` mock implementations                                          |

Entry point: `index.ts` exports `mockServices`.

Features should use hooks from `@/platform/services`, not import mocks directly. Exceptions: UI-only demo paths (e.g. mock folder picker in app settings form).
