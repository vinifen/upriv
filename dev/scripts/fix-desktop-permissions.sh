#!/usr/bin/env bash
# Fix root-owned npm/vite artifacts (usually from a past `sudo npm install`).
# Run once: sudo bash dev/scripts/fix-desktop-permissions.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT/apps/desktop"
ELECTRON="$ROOT/apps/electron"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Re-run with sudo: sudo bash $0" >&2
  exit 1
fi

TARGET_USER="${SUDO_USER:-$USER}"
TARGET_GROUP="$(id -gn "$TARGET_USER")"

PATHS=(
  "$DESKTOP/node_modules"
  "$DESKTOP/dist"
  "$DESKTOP/renderer-out"
  "$DESKTOP/.vite-cache"
  "$ELECTRON/node_modules"
  "$ELECTRON/dist"
)

for path in "${PATHS[@]}"; do
  if [[ -e "$path" ]]; then
    chown -R "$TARGET_USER:$TARGET_GROUP" "$path"
  fi
done

echo "Fixed ownership under desktop + electron build artifacts (user=$TARGET_USER)"
