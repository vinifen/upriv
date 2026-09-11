import type { VaultRootResolveResult } from "./types";

/**
 * Folder that contains `.upriv/` (`vaults/<id>/contents/`, `backups/`, `logs/`).
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

/** `{vault-root}/.upriv/logs` — session logs live under the marker, not beside it. */
export function vaultRootLogsDisplayPath(rootBase: string): string {
  const base = trimRootBase(rootBase);
  if (!base) return "";
  if (isSafContentUri(base)) return `${base} · .upriv/logs`;
  return `${base}/.upriv/logs`;
}

function posixVaultStorePath(
  rootBase: string,
  vaultId: string,
  leaf: "contents" | "backups",
): string {
  const upriv = vaultRootUprivDisplayPath(rootBase);
  return `${upriv}/vaults/${vaultId}/${leaf}/`;
}

/**
 * Diagnostic paths for Vault Info.
 * POSIX vault-root → `{root}/.upriv/vaults/<id>/contents/`.
 * SAF `content://` URIs are not joined as filesystem paths — Info shows the
 * tree URI plus the logical `.upriv/vaults/…` leaf.
 */
export function vaultStoreDisplayPaths(
  rootBase: string,
  vaultId: string,
): { contentsPath: string; backupsPath: string } {
  const base = trimRootBase(rootBase);
  if (isSafContentUri(base)) {
    return {
      contentsPath: `${base} · .upriv/vaults/${vaultId}/contents`,
      backupsPath: `${base} · .upriv/vaults/${vaultId}/backups`,
    };
  }
  return {
    contentsPath: posixVaultStorePath(base, vaultId, "contents"),
    backupsPath: posixVaultStorePath(base, vaultId, "backups"),
  };
}
