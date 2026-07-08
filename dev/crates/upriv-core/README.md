# upriv-core

Shared Rust library for Upriv. All vault logic lives here; `upriv-daemon` (desktop) and mobile bridges are thin adapters.

```bash
cd dev
cargo test -p upriv-core
```

See `dev/docs/ARCHITECTURE.md` and `dev/docs/sdd.md` §4.

## Logging

Structured app logs live in **`logging/`** — writes `.upriv/logs/` only from Rust (React reads via `LogService`).

UTC timestamps use **`time/`** (shared across the crate; `std` only).

```rust
use upriv_core::logging::{LogConfig, Logger};
use upriv_core::{app_version, utc_timestamp_iso_millis};

let config = LogConfig::new("/path/to/.upriv/logs");
let log = Logger::open(config)?;
log.info("app_start", &[("version", app_version())]);
let _ = utc_timestamp_iso_millis();
```

Line format matches `prod-example/README.md` § Logs and `@upriv/shared` `domain/logs/format.ts`.

**Note:** On the Electron migration branch, vault RPC may still be landing — `app_version()` and `logging` are the first stable core surfaces. Version string comes from `dev/VERSION` via `build.rs`.
