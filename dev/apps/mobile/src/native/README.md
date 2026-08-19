# Mobile native bridge (`upriv-ffi`)

In-process Rust via UniFFI — same CORE RPC handlers as desktop `upriv-daemon`
(`upriv-rpc` crate).

```text
RN (Expo module UprivCore)
  → UniFFI Kotlin (JNA)
  → libupriv_ffi.so
  → upriv_ffi::invoke / app_version
  → upriv_rpc::handle_rpc
  → upriv_core::*
```

## Android app home

Android has no `HOME` / `XDG_DATA_HOME`. The Expo module calls UniFFI
`configureRuntime(<filesDir>/upriv, "installed")`, which pins
`UPRIV_DEFAULT_ROOT_ANCHOR` + `UPRIV_DISTRIBUTION` inside Rust before any CORE
RPC (same env Electron sets for the daemon on desktop).

| Runtime                         | Bridge                                                   |
| ------------------------------- | -------------------------------------------------------- |
| Expo Go                         | Mocks only (`createMobileMockServices`)                  |
| `expo-dev-client` / release APK | Live vault-root + settings + logs when `.so` is packaged |

## Build Android `.so`

```bash
# once
cargo install cargo-ndk
# NDK via Android Studio or ANDROID_NDK_HOME

cd dev
./scripts/build-android-ffi.sh
```

Then:

```bash
cd apps/mobile
npx expo prebuild --platform android
npx expo run:android
```

## Regenerate Kotlin only (host `.so`)

```bash
cd dev
cargo build -p upriv-ffi
cargo run -p upriv-ffi --features=cli --bin uniffi-bindgen -- generate \
  --library target/debug/libupriv_ffi.so \
  --language kotlin \
  --out-dir apps/mobile/modules/upriv-core/android/src/main/java
```

## TS entry

- `modules/upriv-core` — Expo module + `isNativeBridgeAvailable()`
- `src/platform/services/createServices.ts` — native if linked, else mocks
- `src/platform/native/createNativeServices.ts` — live root/settings/logs; vault list still mock
