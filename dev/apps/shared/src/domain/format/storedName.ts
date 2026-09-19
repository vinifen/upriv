/**
 * Persistable label: trim + collapse Unicode whitespace to a single space.
 * Vault and group titles only — file-manager names use `persistLogicalFileName`.
 */
export function normalizeStoredName(raw: string): string {
  return raw.trim().replace(/\s+/gu, " ");
}
