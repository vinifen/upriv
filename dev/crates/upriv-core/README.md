# upriv-core

Shared Rust library for Upriv. All vault logic lives here; `upriv-daemon` / `upriv-ffi` are thin adapters over **`upriv-rpc`** (same CORE handlers).

```bash
cd dev
cargo test -p upriv-core
```

See `dev/docs/ARCHITECTURE.md` and `dev/docs/sdd.md` §4.

## Modules

| Module | Role |
|--------|------|
| `config/` | App `.upriv/settings.toml`, per-vault `vaults/<id>/config.toml`, vault groups, edit policy, list saves |
| `device` | This device's ID and system; no name of the computer or phone is read |
| `folder_list/` | Per-device folder lists: model, path rules, chains, the data folder list file, unlocked folder and backup layouts |
| `folder_probe` | Time-limited folder checks, one thread per stuck folder |
| `vault/` | List / create / open / close / rename / delete, in-app file manager (`fs`), export / import, backups, password and unlock-RAM rewrap, `plain/` (`upriv_plain` folders and their records), unlocked folder attach, data folder apply and search, in-RAM `.7z`, data-folder export |
| `store/` | At-rest ciphertext: header (Argon2id wrap), sealed index (AES-SIV names), XChaCha20-Poly1305 chunks |
| `session/` | Open session keys in RAM, unlock throttle |
| `mount/` | Linux FUSE host, Windows WinFsp |
| `paths/` | Layout, launch resolution of the data folder, reserved paths, `initialize_vault_root` |
| `logging/` | Structured `.upriv/logs/` writers |
| `runtime_state` / `lockfile` | `.upriv/state.json` open records and `runtime/<id>.lock` (dirty-close recovery) |
| `host_fs` | Filesystem access, including Android storage-access trees |
| `time/`, `error` | UTC stamps; `UprivError` / `Result` |
| `app_version()` | From repo-root `VERSION` via `build.rs` |

## Data folder at launch

```rust
use upriv_core::{resolve_vault_root, ResolveVaultRoot, ResolveVaultRootOptions};

let outcome = resolve_vault_root(ResolveVaultRootOptions::default())?;
```

Order (see `paths/resolve.rs`):

1. **Explicit** path / `UPRIV_VAULT_ROOT` — wins over the list for the whole process and must be valid; nothing is written for it.
2. **This device's choice** in the data folder list (`.upriv-data-folder` in the app home, `folder_list/data_folder.rs`; a device with no group uses Default):
   - **Default** holding a `.upriv` → `Found` (`source` `default`). None there → `SelectedFailed` while this device has rows to try, else `NeedsSetup` (the first run).
   - **A row** that answers as a data folder → `Found` (`source` `row`). One that does not → `SelectedFailed`.
   - On `SelectedFailed` the UI runs `search_data_folder` while the person may pick. A data folder lost while Upriv runs stays selected, so the resolve after it lands here too. Core keeps the data folder in use (`data_folder_entered`); the RPC resolve that finds it lost ends every vault still open there (`leave_lost_data_folder`), and the search waits for a close or an open still running there before it switches.
3. A list file that cannot be read fails `DataFolderListInvalid`; an incomplete `.upriv` in the selected folder fails `VaultRootIncomplete` (Repair).

**Default** (`paths/distribution.rs`, env `UPRIV_DISTRIBUTION`) is the app home:

| Kind | Default and app home |
|------|----------------------|
| `portable` | Beside AppImage / exe |
| `installed` | User data dir (`~/.local/share/upriv`, …) |
| `dev` | `UPRIV_DEFAULT_ROOT_ANCHOR` (`dev/`) |

`suggested_vault_root()` (`~/Documents/Upriv`) is where Add folder's picker starts on desktop — daemon RPC `vault_root_suggested_custom_path` / `VaultRootService.suggestedCustomRootPath()`.

**How Default is searched** (see `resolve_vault_root` / Electron `daemon.ts`):

| Distribution | Behavior |
|--------------|----------|
| `installed` | Exact Default path only |
| `portable` / `dev` with `UPRIV_DEFAULT_ROOT_ANCHOR` | Exact Default path only |
| Env unset (daemon only) | `discover_vault_root_upward` (walk parents upward) |

### `.upriv-data-folder` (app home)

The data folder list: one TOML table per device (`[devices.<id>]`: `system`, `selected`, `next_number`, `rows`). It exists only while some group differs from the defaults, and holds no secrets. `data_folder_list` reads it, `data_folder_apply` saves a change to it under its lock and opens the folder it selects, and Start a new list (`newList`) replaces a file that cannot be read.

## Logging

Structured **app** logs via **`log_event` / `Logger`** under `.upriv/logs/` (React reads via `LogService` / RPC). Format/names: SDD §3.1 Logs. Mid-session integrity: `.agent/AGENT.md`.

```rust
use upriv_core::logging::{ensure_logging_session, log_event, LogConfig, LogLevel, Logger};
use upriv_core::app_version;

// Product call sites (daemon / core):
log_event(
    LogLevel::Info,
    "app_start",
    &[("version", app_version())],
);

// Or direct writer (tests / bootstrap):
let config = LogConfig::new("/path/to/.upriv/logs");
let log = Logger::open(config)?;
log.info("app_start", &[("version", app_version())]);

let _ = ensure_logging_session(); // daemon: open session from settings + vault-root
```

RPC: `log_list` (metadata), `log_get` (one file + content), `log_delete` (active `current-*` allowed).

- Soft empty list only **true bootstrap** (no root yet this process). After `vault_root_ready`, missing/corrupt `.upriv` → typed `VaultRootNotFound` / `Incomplete` (not `Ok([])`).
- Session clears on NeedsSetup / invalid root; `ensure_logs_dir` never recreates a missing `.upriv` (leaf `logs` only after validate). See `logging/session.rs` + `writer.rs`.
