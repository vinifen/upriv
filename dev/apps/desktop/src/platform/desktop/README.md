# Desktop platform adapters

Real `AppServices` implementations that call `upriv-daemon` via `desktopInvokeRaw()` / `rpc*.ts`.

## Live vs mock

| Service                                               | Desktop (`isDesktop()`)                             | Browser             |
| ----------------------------------------------------- | --------------------------------------------------- | ------------------- |
| `vaultRoot`                                           | **Live** — `vault_root_*` RPCs + `pick_directory`   | mock (localStorage) |
| `appSettings`                                         | **Live** — `app_settings_get` / `app_settings_save` | mock                |
| `vault`                                               | Stub empty `listVaults()` until `vault_list` RPC    | mock rows           |
| backups / logs / filesystem / lifecycle / createVault | mock                                                | mock                |

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

**Strict vs loose:** Electron always sets `UPRIV_NEARBY_ANCHOR` when unpackaged or packaged, so portable installs and `electron .` are strict — a sibling folder with `.upriv` next to the AppImage is **not** auto-imported; use fixed path / create beside the app. Loose walk is the fallback when the env is absent.

Alias `.upriv-root` is created only for fixed-path mode; lives in the **app home** (not necessarily beside the FUSE-mounted binary).
Switching to auto marks it `status=inactive` (path kept); fixed sets `status=active`.
Mode+path are **not** stored in `settings.toml` — the UI fields are derived from `.upriv-root` on load.
