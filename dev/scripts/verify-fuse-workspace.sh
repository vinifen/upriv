#!/usr/bin/env bash
# Verify encrypted_dir opens with FUSE (release build) against prod-example.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROD="${UPRIV_VAULT_ROOT:-$REPO_ROOT/prod-example}"
VAULT_ID="${UPRIV_TEST_VAULT:-teste1}"

echo "==> Vault root: $PROD"
echo "==> Vault id:   $VAULT_ID"

# Drop stale locks / plaintext workspace from debug sessions.
rm -f "$PROD/.upriv/runtime/${VAULT_ID}.lock"
rm -rf "$PROD/workspace/${VAULT_ID}"

cd "$REPO_ROOT/dev"
UPRIV_VAULT_ROOT="$PROD" UPRIV_TEST_VAULT="$VAULT_ID" UPRIV_TEST_PASSWORD="${UPRIV_TEST_PASSWORD:-teste1}" \
  cargo test -p upriv-core --release prod_example_workspace_uses_fuse_in_release -- --nocapture

echo ""
echo "==> Release binary:"
ls -la "$REPO_ROOT/dev/target/release/upriv"
echo ""
echo "==> Bundles:"
ls -la "$REPO_ROOT/dev/target/release/bundle/deb/"*.deb 2>/dev/null || true
ls -la "$REPO_ROOT/dev/target/release/bundle/appimage/"*.AppImage 2>/dev/null || true

echo ""
echo "OK — FUSE mount verified for $VAULT_ID in release profile."
