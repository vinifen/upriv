# Desktop platform adapters

Real `AppServices` implementations that call `upriv-daemon` via `desktopInvokeRaw()` / `rpc*.ts`.

## Live vs mock

| Service                                               | Desktop (`isDesktop()`)                             | Browser          |
| ----------------------------------------------------- | --------------------------------------------------- | ---------------- |
| `vaultRoot`                                           | **Live** — `vault_root_*` RPCs + `pick_directory`   | mock (in-memory) |
| `appSettings`                                         | **Live** — `app_settings_get` / `app_settings_save` | mock             |
| `vault`                                               | Stub empty `listVaults()` until `vault_list` RPC    | mock rows        |
| backups / logs / filesystem / lifecycle / createVault | mock                                                | mock             |

`createServices()`:

```typescript
if (isDesktop()) return createDesktopServices();
return mockServices;
```

## Layout

```text
platform/desktop/
├── README.md
├── createDesktopServices.ts
└── services/
    ├── appSettingsService.ts
    └── vaultRootService.ts
```

### Dev vs prod nearby create

| Mode                                          | App home (`UPRIV_NEARBY_ANCHOR`)                                | Auto nearby search                                      |
| --------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| Unpackaged Electron (with or without `--dev`) | `upriv/dev/` → `dev/.upriv/` and `dev/.upriv-root`              | **Strict** — exact folder only (avoids `prod-example/`) |
| Packaged AppImage                             | Beside the `.AppImage` file (`$APPIMAGE`) — not `/tmp/.mount_*` | **Strict** — exact folder only                          |
| Packaged Windows / other                      | Directory of the executable                                     | **Strict** — exact folder only                          |
| Packaged macOS `.app`                         | Directory that contains the `.app` bundle                       | **Strict** — exact folder only                          |
| Daemon without Electron setting the env       | (unset)                                                         | **Loose** — walk parents + one sibling level            |

**Strict vs loose:** Electron always sets `UPRIV_NEARBY_ANCHOR` when unpackaged or packaged, so portable installs and `electron .` are strict — a sibling folder with `.upriv` next to the AppImage is **not** auto-imported; use custom mode / create beside the app. Loose walk is the fallback when the env is absent.

Alias `.upriv-root` is created only for custom mode; lives in the **app home** (not necessarily beside the FUSE-mounted binary).
Switching to nearby marks it `status=inactive` (path kept); custom sets `status=active`.
Mode+path are **not** stored in `settings.toml` — the UI fields are derived from `.upriv-root` on load.

### RPC naming convention

- **Settings payload** (`app_settings_get` / `app_settings_save` body): **snake_case** nested keys (`ui`, `logging`, `app.vault_root_mode`).
- **Vault-root command params** (`vault_root_resolve`, `vault_root_setup_*`, …): **camelCase** (`vaultRootMode`, `replaceIncomplete`, `replacePolicy`).
- Optional save flag `syncAlias` (camelCase) sits beside the flattened settings object.
