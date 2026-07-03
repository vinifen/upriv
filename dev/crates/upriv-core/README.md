# upriv-core

Shared Rust library for Upriv. All vault logic lives here; `src-tauri` and mobile bridges are thin adapters.

## Modules (v0.1 scaffold)

| Module | Status |
|--------|--------|
| `paths` | `VaultRoot` — canonical vault-root paths |
| `config` | Load `.upriv/settings.toml` and `vaults/*/config.toml` |
| `storage` | `VaultStorage` trait + `FsVaultStorage` (desktop) |
| `seven_zip` | `7zz` / `7z` wrapper (test, extract, create) |
| `plain` | **`plain` mode** open/close + `secure_wipe_workspace` |
| `session` | `SessionPassword` (RAM, `zeroize`) |

## Quick example (`plain` mode)

```rust
use upriv_core::{
    plain_close, plain_open, load_app_settings, SevenZip, SessionPassword, VaultRoot,
};

let root = VaultRoot::discover("/path/to/vault-root")?;
let settings = load_app_settings(&root)?;
let seven_zip = SevenZip::resolve(&root, &settings)?;

let session = plain_open(&root, "my-vault-id", SessionPassword::from("password"), &seven_zip)?;
// … user edits files under session.workspace_path …
plain_close(&root, session, &seven_zip)?;
```

## 7-Zip binary

Resolution order:

1. `UPRIV_7ZZ_PATH` environment variable
2. `.upriv/app/<OS-arch>/bin/7zz` under the vault root
3. `7zz` / `7z` on `PATH`

## Tests

```bash
cd dev
cargo test -p upriv-core
```

Integration tests require `7z` or `7zz` on `PATH` (or set `UPRIV_7ZZ_PATH`).

See `dev/docs/ARCHITECTURE.md` and `dev/docs/sdd.md` §4.
