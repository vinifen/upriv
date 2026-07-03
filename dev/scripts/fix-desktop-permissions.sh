#!/usr/bin/env bash
# Fix root-owned npm/vite artifacts (usually from a past `sudo npm install`).
# Run once: bash dev/scripts/fix-desktop-permissions.sh
set -euo pipefail

DESKTOP="$(cd "$(dirname "$0")/../apps/desktop" && pwd)"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Re-run with sudo: sudo bash $0" >&2
  exit 1
fi

TARGET_USER="${SUDO_USER:-$USER}"
TARGET_GROUP="$(id -gn "$TARGET_USER")"

chown -R "$TARGET_USER:$TARGET_GROUP" "$DESKTOP/node_modules" "$DESKTOP/dist" 2>/dev/null || true
echo "Fixed ownership under $DESKTOP (user=$TARGET_USER)"
