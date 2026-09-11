#!/usr/bin/env bash
# Regenerate UniFFI Kotlin into a temp dir and diff against the committed file.
# Host build only — no Android NDK. Fails if the checked-in binding is stale.
set -euo pipefail

DEV="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DEV"

COMMITTED="apps/mobile/modules/upriv-core/android/src/main/java/uniffi/upriv_ffi/upriv_ffi.kt"
if [[ ! -f "$COMMITTED" ]]; then
  echo "error: missing committed UniFFI Kotlin at $COMMITTED" >&2
  exit 1
fi

echo "Building upriv-ffi (host) for UniFFI metadata…"
cargo build -p upriv-ffi

LIB=""
for candidate in \
  target/debug/libupriv_ffi.so \
  target/debug/libupriv_ffi.dylib \
  target/debug/upriv_ffi.dll \
  target/release/libupriv_ffi.so \
  target/release/libupriv_ffi.dylib \
  target/release/upriv_ffi.dll
do
  if [[ -f "$candidate" ]]; then
    LIB="$candidate"
    break
  fi
done
if [[ -z "$LIB" ]]; then
  echo "error: upriv-ffi library not found after cargo build" >&2
  exit 1
fi

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

echo "Generating Kotlin UniFFI bindings into $TMP…"
cargo run -p upriv-ffi --features=cli --bin uniffi-bindgen -- generate \
  --library "$LIB" \
  --language kotlin \
  --out-dir "$TMP"

GENERATED="$TMP/uniffi/upriv_ffi/upriv_ffi.kt"
if [[ ! -f "$GENERATED" ]]; then
  echo "error: bindgen did not write $GENERATED" >&2
  exit 1
fi

if ! diff -u "$COMMITTED" "$GENERATED"; then
  echo "error: committed UniFFI Kotlin is stale vs crates/upriv-ffi." >&2
  echo "Regenerate with the host command in apps/mobile/src/native/README.md" >&2
  echo "or ./scripts/build-android-ffi.sh (also rebuilds Android .so)." >&2
  exit 1
fi

echo "OK  UniFFI Kotlin matches crates/upriv-ffi"
