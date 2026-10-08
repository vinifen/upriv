/**
 * Logical path Rust uses while the Android data folder is a folder the user
 * picked. The bytes live in that folder's storage-access grant. This path is
 * not created on disk. Must match `SAF_VAULT_ROOT` in `upriv-core` `host_fs`.
 */
export const SAF_VAULT_ROOT = "/upriv-saf-root";

export function isSafLogicalRoot(path: string): boolean {
  const trimmed = path.trim().replace(/\/+$/, "");
  return trimmed === SAF_VAULT_ROOT;
}
