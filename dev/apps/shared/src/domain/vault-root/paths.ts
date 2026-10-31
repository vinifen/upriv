import type { VaultRootResolveResult } from "./types";

/**
 * Logical path the core uses while the Android data folder is a folder the
 * user picked. The bytes live in that folder's storage-access grant; this
 * path is not on disk. Must match `SAF_VAULT_ROOT` in `upriv-core` `host_fs`.
 */
export const SAF_VAULT_ROOT = "/upriv-saf-root";

/**
 * Folder that contains `.upriv/` (`vaults/<id>/store/`, `backups/`, `logs/`).
 * Wire `rootPath` from `vault_root_resolve` is this folder — not `.upriv` itself.
 * Prefer a successful resolve; `fallback` is mock / last-resort only.
 */
export function vaultRootContentorPath(root: VaultRootResolveResult, fallback: string): string {
  if (root.status === "found") {
    const trimmed = root.rootPath.trim();
    if (trimmed) return trimmed;
  }
  return fallback;
}

/** Android SAF tree (or mock SAF stub). Not a POSIX filesystem path. */
export function isSafContentUri(value: string): boolean {
  return value.trim().toLowerCase().startsWith("content://");
}

function trimRootBase(rootBase: string): string {
  return rootBase.trim().replace(/[/\\]+$/, "");
}

/**
 * `{vault-root}/.upriv` on POSIX; SAF URIs stay as the tree plus a logical `.upriv` label.
 */
export function vaultRootUprivDisplayPath(rootBase: string): string {
  const base = trimRootBase(rootBase);
  if (!base) return "";
  if (isSafContentUri(base)) return `${base} · .upriv`;
  return `${base}/.upriv`;
}

/**
 * Location the system file manager opens for `.upriv/<inside>` of a data
 * folder. A storage-access tree has no filesystem path, so it is the logical
 * path under {@link SAF_VAULT_ROOT}, which the app maps to that tree's document.
 */
export function vaultRootUprivOpenPath(rootBase: string, inside: string): string {
  const base = trimRootBase(rootBase);
  if (!base) return "";
  return `${isSafContentUri(base) ? SAF_VAULT_ROOT : base}/.upriv/${inside}`;
}

/** `{vault-root}/.upriv/logs` — session logs live under the marker, not beside it. */
export function vaultRootLogsDisplayPath(rootBase: string): string {
  const base = trimRootBase(rootBase);
  if (!base) return "";
  if (isSafContentUri(base)) return `${base} · .upriv/logs`;
  return `${base}/.upriv/logs`;
}

function posixVaultStorePath(rootBase: string, vaultId: string, leaf: "store" | "backups"): string {
  const upriv = vaultRootUprivDisplayPath(rootBase);
  return `${upriv}/vaults/${vaultId}/${leaf}/`;
}

/**
 * Diagnostic paths for Vault Info.
 * POSIX vault-root → `{root}/.upriv/vaults/<id>/store/`.
 * SAF `content://` URIs are not joined as filesystem paths — Info shows the
 * tree URI plus the logical `.upriv/vaults/…` leaf.
 */
export function vaultStoreDisplayPaths(
  rootBase: string,
  vaultId: string,
): { storePath: string; backupsPath: string } {
  const base = trimRootBase(rootBase);
  if (isSafContentUri(base)) {
    return {
      storePath: `${base} · .upriv/vaults/${vaultId}/store`,
      backupsPath: `${base} · .upriv/vaults/${vaultId}/backups`,
    };
  }
  return {
    storePath: posixVaultStorePath(base, vaultId, "store"),
    backupsPath: posixVaultStorePath(base, vaultId, "backups"),
  };
}
