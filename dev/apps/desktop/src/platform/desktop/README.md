# Desktop platform adapters

Real `AppServices` implementations that call `upriv-daemon` via `desktopInvokeRaw()` / `rpc*.ts`.

## Live adapters

| Service       | Desktop                                                    |
| ------------- | ---------------------------------------------------------- |
| `vaultRoot`   | `vault_root_*` RPCs + `pick_directory`                     |
| `appSettings` | `app_settings_get` / `app_settings_save`                   |
| `logs`        | `log_list` / `log_get` / `log_delete`                      |
| `vault`       | list / create / import / config / rename / delete / export |
| `lifecycle`   | `vault_open` / `vault_close`                               |
| `vaultGroups` | group list / create / update / delete / reorder            |
| `filesystem`  | `vault_fs_*` (in-app file manager)                         |
| `backups`     | `backup_*` (ciphertext `backups/<stamp>-<id>.zip`)         |
| `createVault` | `pick_file` + `vault_import_probe`                         |

`createServices()` always returns `createDesktopServices()`. Vault calls need the Electron preload.

## Layout

```text
platform/desktop/
├── README.md
├── createDesktopServices.ts
└── services/
    ├── appSettingsService.ts
    ├── backupService.ts
    ├── createVaultService.ts
    ├── logService.ts
    ├── vaultFileSystemService.ts
    ├── vaultGroupService.ts
    ├── vaultLifecycleService.ts
    ├── vaultRootService.ts
    └── vaultService.ts
```

### Where Default is

| Launch                           | `UPRIV_DISTRIBUTION` | App home                         | Default          |
| -------------------------------- | -------------------- | -------------------------------- | ---------------- |
| Unpackaged Electron              | `dev`                | `upriv/dev/`                     | Same as app home |
| Packaged AppImage / portable exe | `portable`           | Beside the downloaded file / exe | Same as app home |
| Packaged `.deb` / NSIS / system  | `installed`          | User data dir                    | Same as app home |
| Daemon without Electron env      | inferred             | writable exe dir or user data    | Same as app home |

The app home holds the data folder list (`.upriv-data-folder`), every device's group. A device with no group uses Default, so a portable copy opens the data folder beside it on any machine. A Windows NSIS install is **installed** even when its folder is writable, so `.upriv` is not created inside the directory the uninstaller deletes.

**Strict vs loose:** Electron always sets `UPRIV_DEFAULT_ROOT_ANCHOR` when unpackaged or packaged, so Default is that exact folder — a sibling folder with `.upriv` next to the AppImage is **not** picked up; add it as a row of the list instead. The upward walk (`discover_vault_root_upward`) is the fallback only when the env is absent.

### RPC naming convention

- **Settings payload** (`app_settings_get` result / nested `settings` on save): **snake_case** nested keys (`ui`, `logging`, `app`, `unlocked_folders`, `backups`).
- **Data folder command params** (`vault_root_resolve`, `data_folder_list`, `data_folder_apply`, `data_folder_search`): **camelCase** (`explicitPath`, `newList`, `replaceIncomplete`, `replacePolicy`, `adoptPrivateRoot`).
- **`app_settings_save` envelope:** `{ "settings": { … }, "lists": { … } }`. The folder lists inside `settings` are not read: `lists` carries what changed in them (`AppListChanges`), and core applies that to the file it reads again.
