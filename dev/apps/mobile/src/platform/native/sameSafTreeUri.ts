/**
 * Compare Android SAF tree URIs from `ACTION_OPEN_DOCUMENT_TREE`.
 * Encoding (`%3A` vs `:`) and a trailing `/document/…` leaf must not look like
 * a different tree — import-folder must not drop the vault-root grant.
 */

function decodeUriLoose(uri: string): string {
  const trimmed = uri.trim();
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function treeParts(decoded: string): { authority: string; treeId: string } | null {
  const match = /^content:\/\/([^/]+)\/tree\/(.+)$/i.exec(decoded);
  if (!match) return null;
  const authority = (match[1] ?? "").toLowerCase();
  let treeId = match[2] ?? "";
  const documentSep = treeId.toLowerCase().indexOf("/document/");
  if (documentSep >= 0) treeId = treeId.slice(0, documentSep);
  treeId = treeId.replace(/\/+$/, "");
  if (!authority || !treeId) return null;
  return { authority, treeId };
}

export function sameSafTreeUri(left: string, right: string): boolean {
  const a = decodeUriLoose(left);
  const b = decodeUriLoose(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const pa = treeParts(a);
  const pb = treeParts(b);
  if (pa && pb) return pa.authority === pb.authority && pa.treeId === pb.treeId;
  return false;
}

/**
 * Persistable grant from the import-folder picker should be dropped after the
 * read, except when that tree is the active custom vault-root.
 */
export function shouldReleaseImportTreePermission(
  importUri: string,
  activeVaultRootUri: string | null | undefined,
): boolean {
  if (!importUri.trim().startsWith("content://")) return false;
  if (!activeVaultRootUri?.trim()) return true;
  return !sameSafTreeUri(importUri, activeVaultRootUri);
}
