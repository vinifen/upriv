/**
 * Logical path Rust uses while the Android data folder is a folder the user
 * picked. The bytes live in that folder's storage-access grant. This path is
 * not created on disk. Must match `SAF_VAULT_ROOT` in `upriv-core` `host_fs`.
 */
export const SAF_VAULT_ROOT = "/upriv-saf-root";

/**
 * Logical folder Rust writes the Export data folder zip into while a picked
 * folder is mounted for it. Must match `SAF_EXPORT_ROOT` in `upriv-core` `host_fs`.
 */
export const SAF_EXPORT_ROOT = "/upriv-saf-export";

export function isSafLogicalRoot(path: string): boolean {
  const trimmed = path.trim().replace(/\/+$/, "");
  return trimmed === SAF_VAULT_ROOT;
}
