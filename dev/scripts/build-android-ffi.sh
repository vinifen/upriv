#!/usr/bin/env bash
# Build libupriv_ffi.so for Android and copy into the Expo module jniLibs.
# Requires: Android NDK, rustup android targets, cargo-ndk.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# ROOT = dev/
FFI_OUT="$ROOT/apps/mobile/modules/upriv-core/android/src/main/jniLibs"
DEV="$ROOT"

cd "$DEV"

if ! command -v cargo-ndk >/dev/null 2>&1; then
  echo "cargo-ndk not found. Install: cargo install cargo-ndk"
  exit 1
fi

TARGETS=(
  aarch64-linux-android
  armv7-linux-androideabi
  x86_64-linux-android
)

for t in "${TARGETS[@]}"; do
  rustup target add "$t" >/dev/null
done

echo "Building upriv-ffi for Android (NDK)…"
cargo ndk \
  -t arm64-v8a \
  -t armeabi-v7a \
  -t x86_64 \
  -o "$FFI_OUT" \
  build -p upriv-ffi --release

# Mobile loads only UniFFI `libupriv_ffi.so` (upriv-core is an rlib linked into it).
# Drop any stale sibling cdylib left from older builds.
find "$FFI_OUT" -name 'libupriv_core.so' -delete 2>/dev/null || true

echo "Regenerating Kotlin UniFFI bindings…"
cargo build -p upriv-ffi --release
cargo run -p upriv-ffi --features=cli --bin uniffi-bindgen -- generate \
  --library target/release/libupriv_ffi.so \
  --language kotlin \
  --out-dir apps/mobile/modules/upriv-core/android/src/main/java

echo "Done. jniLibs → $FFI_OUT"
find "$FFI_OUT" -name 'libupriv_ffi.so' -print
if find "$FFI_OUT" -name 'libupriv_core.so' | grep -q .; then
  echo "error: unexpected libupriv_core.so under jniLibs (upriv-core must stay rlib-only)" >&2
  exit 1
fi
