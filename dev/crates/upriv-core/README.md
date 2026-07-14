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
use upriv_core::{resolve_vault_root, ResolveVaultRootOptions, ResolveVaultRoot};

let outcome = resolve_vault_root(ResolveVaultRootOptions {
    explicit: None,
    auto_detect: true,
    binary_dir: None,
})?;
```

Order (see `paths/resolve.rs`):

1. **Explicit** path / `UPRIV_VAULT_ROOT` — must be valid or error  
2. **Fixed** (`auto_detect=false`): open remembered `.upriv-root` path (active or inactive)  
3. **Auto** (`auto_detect=true`): search nearby from app home (then cwd); **active alias is ignored**  
4. **NeedsSetup** — UI offers create-nearby vs choose-path (+ alias)

**Nearby search strictness** (see `resolve_vault_root` / Electron `daemon.ts`):

| When `UPRIV_NEARBY_ANCHOR` is… | Behavior |
|-------------------------------|----------|
| Set (Electron `--dev` or packaged) | **Strict** — only `.upriv` at that exact path |
| Unset | **Loose** — `discover_vault_root_near` (parents + sibling at start) |

Strict is tied to the **env being set**, not to a separate “dev flag”. Packaged AppImage/Win/macOS are strict too: moving the binary next to an unrelated sibling `.upriv` will not auto-import it.

### `.upriv-root` alias (app home)

| File state | Meaning |
|------------|---------|
| Missing | Auto-detect nearby (no fixed path remembered) |
| `status=inactive` + path | Auto in use; path kept for switching back to fixed |
| `status=active` + path | Fixed vault-root (when settings say fixed) |

- Switching to auto **deactivates** the alias (keeps path); fixed reactivates / rewrites it  
- File is created only when the user first chooses another folder  
- Prefer `deactivate_vault_root_alias` over `delete_vault_root_alias` for mode switches  

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
