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

`./run lint` regenerates Kotlin from the host `upriv-ffi` library and diffs it
against the committed `upriv_ffi.kt`. The TypeScript types in
`apps/mobile/modules/upriv-core/src/index.ts` are hand-written — keep them in
sync with the UniFFI surface.
