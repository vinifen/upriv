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
| `app_version()` | From `dev/VERSION` via `build.rs` |

Next: `config/` (TOML load) → `vault_list` RPC.

## Vault-root resolve

```rust
use upriv_core::{resolve_vault_root, ResolveVaultRootOptions, ResolveVaultRoot, VaultRootMode};

let outcome = resolve_vault_root(ResolveVaultRootOptions {
    explicit: None,
    mode: VaultRootMode::Nearby,
    binary_dir: None,
})?;
```

Order (see `paths/resolve.rs`):

1. **Explicit** path / `UPRIV_VAULT_ROOT` — always wins over wire mode/path; must be valid or error  
2. **Custom** (`VaultRootMode::Custom`): open **active** `.upriv-root` path only (inactive → NeedsSetup)  
3. **Nearby** (`VaultRootMode::Nearby`): search nearby from app home (then cwd); **active alias is ignored**  
4. **NeedsSetup** — UI offers create-nearby vs choose-path (+ alias)

`UPRIV_VAULT_ROOT` overrides Settings mode/path for the whole process; the desktop Gate shows a dismissible notice when resolve `source` is `explicit` and Settings disagree.

**Nearby search strictness** (see `resolve_vault_root` / Electron `daemon.ts`):

| When `UPRIV_NEARBY_ANCHOR` is… | Behavior |
|-------------------------------|----------|
| Set (Electron `--dev` or packaged) | **Strict** — only `.upriv` at that exact path |
| Unset | **Loose** — `discover_vault_root_near` (parents + sibling at start) |

Strict is tied to the **env being set**, not to a separate “dev flag”. Packaged AppImage/Win/macOS are strict too: moving the binary next to an unrelated sibling `.upriv` will not auto-import it.

### `.upriv-root` alias (app home)

| File state | Meaning |
|------------|---------|
| Missing | Nearby mode (no custom path remembered) |
| `status=inactive` + path | Nearby in use; path kept for switching back to custom |
| `status=active` + path | Custom vault-root (when settings say custom) |

- Switching to nearby **deactivates** the alias (keeps path); custom reactivates / rewrites it  
- File is created only when the user first chooses another folder  
- Prefer `deactivate_vault_root_alias` for mode switches (delete helpers are crate-internal)  

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
