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

### Dev vs prod default_root create

| Mode                             | `UPRIV_DISTRIBUTION` | App home                      | Default vault (default_root) |
| -------------------------------- | -------------------- | ----------------------------- | ---------------------------- |
| Unpackaged Electron              | `dev`                | `upriv/dev/`                  | Same                         |
| Packaged AppImage / portable exe | `portable`           | Beside `$APPIMAGE` / exe      | Same                         |
| Packaged `.deb` / NSIS / system  | `installed`          | User data dir                 | Same as app home             |
| Daemon without Electron env      | inferred             | writable exe dir or user data | distribution-aware           |

First-run setup defaults to **`default_root`** for all distributions (beside the app when portable; user data dir when installed).

**Strict vs loose:** Electron always sets `UPRIV_DEFAULT_ROOT_ANCHOR` when unpackaged or packaged, so portable installs and `electron .` are strict — a sibling folder with `.upriv` next to the AppImage is **not** auto-imported; use `custom_root` mode / create in the default data folder. Loose walk (`discover_vault_root_upward`) is the fallback when the env is absent. Repo `prod-example/` is a layout reference only — **not** auto-discovered in `electron:dev` (use `UPRIV_VAULT_ROOT` to point at it).

Alias `.upriv-root` is created only for `custom_root` mode; lives in the **app home** (not necessarily beside the FUSE-mounted binary).
Switching to `default_root` marks it `status=inactive` (path kept); `custom_root` sets `status=active`.
Mode+path are **not** stored in `settings.toml` — the UI fields are derived from `.upriv-root` on load.

### RPC naming convention

- **Settings payload** (`app_settings_get` result / nested `settings` on save): **snake_case** nested keys (`ui`, `logging`, `app.vault_root_mode`).
- **Vault-root command params** (`vault_root_resolve`, `vault_root_setup_*`, …): **camelCase** (`vaultRootMode`, `replaceIncomplete`, `replacePolicy`).
- **`app_settings_save` envelope:** `{ "settings": { … }, "syncAlias": true }` — `syncAlias` is camelCase only (`sync_alias` is rejected). Settings are **not** flattened with the flag.
