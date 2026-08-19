# upriv-ffi

UniFFI bridge for mobile. Exports:

- `app_version() -> String`
- `invoke(method, params_json) -> String` — same envelope as the daemon (`{ ok, result | error }`)

```bash
cd dev
cargo test -p upriv-ffi
cargo build -p upriv-ffi
# Android .so + Kotlin bindings:
./scripts/build-android-ffi.sh
```

See `apps/mobile/src/native/README.md`.
