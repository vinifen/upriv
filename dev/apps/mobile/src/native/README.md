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

`filesDir/upriv` is app-specific storage. Android removes it when the app is
uninstalled, and the app can write there with no user prompt. A directory
created there can be named Documents and is still deleted with the app. That
directory keeps the folder pointer (`.upriv-root`) and the saved grant. It
does not keep `.upriv/`.

The vault lives in the phone's shared **Documents/Upriv**. Shared storage
stays after uninstall. Android will not let the app create that folder on its
own, so setup opens the system screen on Documents and the user confirms it
once (`ACTION_OPEN_DOCUMENT_TREE`). Upriv then creates `Upriv` inside the
grant. Uninstall drops the grant. The ciphertext stays. The next install
confirms the same folder and opens the existing `.upriv` as-is.

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

The Expo/TS surface in `modules/upriv-core/src/index.ts` is **hand-written**. When
you change UniFFI exports (`app_version`, `invoke`, `configure_runtime`, …),
update that file in the same change as the generated
`uniffi/upriv_ffi/upriv_ffi.kt`. `./run lint` diffs the Kotlin against a fresh
bindgen output so the `.kt` cannot drift silently.

- `modules/upriv-core` — Expo module + `isNativeBridgeAvailable()`
- `src/platform/services/createServices.ts` — native if linked, else mocks
- `src/platform/native/createNativeServices.ts` — live root/settings/logs; vault list still mock
