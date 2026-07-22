# upriv-core

Shared Rust library for Upriv. All vault logic lives here; `upriv-daemon` (desktop) and mobile bridges are thin adapters.

```bash
cd dev
cargo test -p upriv-core
```

See `dev/docs/ARCHITECTURE.md` and `dev/docs/sdd.md` §4.

## Current surface

| Module | Role |
|--------|------|
| `logging/` | Structured `.upriv/logs/` writers |
| `time/` | UTC stamps (`std` only) |
| `error` | `UprivError` / `Result` |
| `paths/` | Layout helpers, resolve, `.upriv-root` alias, `initialize_vault_root` |
| `config/app_settings` | **App** `.upriv/settings.toml` load/save (system prefs) |
| `config/vault_config` | **Per-vault** `vaults/<id>/config.toml` load (list stub) |
| `vault/` | `list_vault_entries` scan (**crate-internal** until `vault_list` RPC) |
| `app_version()` | From `dev/VERSION` via `build.rs` |

Next: `vault_list` RPC → open/close pipeline.

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
2. **CustomRoot** (`VaultRootMode::CustomRoot`): open **active** `.upriv-root` path only (inactive → NeedsSetup)  
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

### `.upriv-root` alias (app home)

| File state | Meaning |
|------------|---------|
| Missing | Default-root mode (no custom path remembered) |
| `status=inactive` + path | Default_root in use; path kept for switching back to custom_root |
| `status=active` + path | Custom vault-root (when settings say `custom_root`) |

- Switching to default_root **deactivates** the alias (keeps path); custom_root reactivates / rewrites it  
- File is created only when the user first chooses another folder  
- Prefer `deactivate_vault_root_alias_everywhere` for mode switches (single-home helper is crate-internal)  

## Logging

Structured app logs live in **`logging/`** — writes `.upriv/logs/` only from Rust (React reads via `LogService`).

```rust
use upriv_core::logging::{LogConfig, Logger};
use upriv_core::{app_version, utc_timestamp_iso_millis};

let config = LogConfig::new("/path/to/.upriv/logs");
let log = Logger::open(config)?;
log.info("app_start", &[("version", app_version())]);
let _ = utc_timestamp_iso_millis();
```
