#!/usr/bin/env bash
# Build AppImage/.deb on Ubuntu 22.04 (GLIBC 2.35) for wider Linux compatibility.
# Usage: ./dev/scripts/build-linux-portable.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEV_DIR="$REPO_ROOT/dev"
IMAGE_NAME="upriv-linux-build:22.04"
DOCKERFILE="$DEV_DIR/scripts/docker/Dockerfile.linux-build"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install docker.io or build on Ubuntu 22.04 natively." >&2
  exit 1
fi

echo "==> Building Docker image ($IMAGE_NAME)..."
docker build -t "$IMAGE_NAME" -f "$DOCKERFILE" "$DEV_DIR/scripts/docker"

echo "==> Building Upriv inside Ubuntu 22.04 container..."
docker run --rm \
  -v "$REPO_ROOT:/upriv" \
  -w /upriv/dev \
  "$IMAGE_NAME" \
  bash -lc '
    set -euo pipefail
    rustup show
    npm ci --prefix apps/desktop
    npm run tauri:build
    echo ""
    echo "=== GLIBC symbols (should be <= 2.35 for 22.04 compat) ==="
    strings target/release/bundle/appimage/Upriv_*.AppImage 2>/dev/null \
      | grep "^GLIBC_" | sort -Vu | tail -5 || true
  '

OUT="$DEV_DIR/target/release/bundle"
echo ""
echo "Done. Artifacts:"
ls -la "$OUT/appimage/"*.AppImage 2>/dev/null || true
ls -la "$OUT/deb/"*.deb 2>/dev/null || true
echo ""
echo "Copy to USB: AppImage + dev/scripts/run-linux.sh + dev/scripts/LINUX-PORTABLE.txt"
