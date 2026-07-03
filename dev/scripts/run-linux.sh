#!/usr/bin/env bash
# Run Upriv on Linux without relying on double-click / execute bit on exFAT USB.
# Usage (from terminal):  bash run-linux.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPIMAGE=""

for candidate in \
  "$DIR"/Upriv_*.AppImage \
  "$DIR"/upriv \
  "$DIR"/Upriv; do
  if [[ -f "$candidate" ]]; then
    APPIMAGE="$candidate"
    break
  fi
done

if [[ -z "$APPIMAGE" ]]; then
  echo "Upriv: no AppImage or binary found next to this script." >&2
  echo "Put run-linux.sh in the same folder as Upriv_*.AppImage" >&2
  exit 1
fi

chmod +x "$APPIMAGE" 2>/dev/null || true
exec "$APPIMAGE" "$@"
