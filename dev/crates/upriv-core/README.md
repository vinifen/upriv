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
| `config/` | App `.upriv/settings.toml`, per-vault `vaults/<id>/config.toml`, vault groups, edit policy |
| `vault/` | List / create / open / close / rename / delete, in-app file manager (`fs`), export / import, backups, password and unlock-RAM rewrap, `plain/` (`upriv_plain` folders), in-RAM `.7z`, data-folder export |
| `store/` | At-rest ciphertext: header (Argon2id wrap), sealed index (AES-SIV names), XChaCha20-Poly1305 chunks |
| `session/` | Open session keys in RAM, unlock throttle |
| `mount/` | Linux FUSE host, Windows WinFsp |
| `paths/` | Layout, vault-root resolve, `.upriv-data-folder` alias, workspace paths, `initialize_vault_root` |
| `logging/` | Structured `.upriv/logs/` writers |
| `runtime_state` / `lockfile` | `.upriv/state.json` open records and `runtime/<id>.lock` (dirty-close recovery) |
| `host_fs` | Filesystem access, including Android storage-access trees |
| `time/`, `error` | UTC stamps; `UprivError` / `Result` |
| `app_version()` | From repo-root `VERSION` via `build.rs` |

## Vault-root resolve

```rust
use upriv_core::{resolve_vault_root, ResolveVaultRootOptions, ResolveVaultRoot, VaultRootMode};

let outcome = resolve_vault_root(ResolveVaultRootOptions {
    explicit: None,
    mode: VaultRootMode::DefaultRoot,
    binary_dir: None,
})?;
```

Order (see `paths/resolve.rs`):

1. **Explicit** path / `UPRIV_VAULT_ROOT` — always wins over wire mode/path; must be valid or error  
2. **CustomRoot** (`VaultRootMode::CustomRoot`): open **active** `.upriv-data-folder` path only (inactive → NeedsSetup)  
3. **DefaultRoot** (`VaultRootMode::DefaultRoot`): search default_root from app home (then cwd); **active alias is ignored**  
4. **NeedsSetup** — UI offers create `default_root` vs choose-path (+ alias + `distribution`)

**Distribution** (`paths/distribution.rs`, env `UPRIV_DISTRIBUTION`):

| Kind | Default vault folder (default_root) | App home (alias) |
|------|-------------------------------|------------------|
| `portable` | Beside AppImage / exe | Same |
| `installed` | User data dir (`~/.local/share/upriv`, …) | Same |
| `dev` | `UPRIV_DEFAULT_ROOT_ANCHOR` (`dev/`) | Same |

Installed default_root search does **not** walk cwd/parents — only the app-home vault path. `suggested_vault_root()` (`~/Documents/Upriv`) is a Rust helper for **`custom_root` folder-picker hints** — wired as daemon RPC `vault_root_suggested_custom_path` / `VaultRootService.suggestedCustomRootPath()`.

`UPRIV_VAULT_ROOT` overrides Settings mode/path for the whole process; the desktop Gate shows a dismissible notice when resolve `source` is `explicit` and Settings disagree.

**Default-root search strictness** (see `resolve_vault_root` / Electron `daemon.ts`):

| Distribution | Behavior |
|--------------|----------|
| `installed` | Exact default vault path only |
| `portable` / `dev` with `UPRIV_DEFAULT_ROOT_ANCHOR` | **Strict** at default vault anchor |
| Env unset (daemon only) | **Loose** — `discover_vault_root_upward` (walk parents upward) |

### `.upriv-data-folder` alias (app home)

| File state | Meaning |
|------------|---------|
| Missing | Default-root mode (no custom path remembered) |
| `status=inactive` + `data_folder=` | Default_root in use; path kept for switching back to custom_root |
| `status=active` + `data_folder=` | Custom vault-root (when settings say `custom_root`) |
| A line without a known key | Invalid (`VaultRootAliasInvalid`) |

Android adds `android_custom_folder=` (the last Custom folder, `content://`) once one is picked.

- Switching to default_root **deactivates** the alias (keeps path); custom_root reactivates / rewrites it  
- File is created only when the user first chooses another folder  
- Mode switches call `deactivate_app_home_alias` (the helper that takes a home is crate-internal)  

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
