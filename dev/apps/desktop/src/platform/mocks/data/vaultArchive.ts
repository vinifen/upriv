import type { VaultRow } from "@upriv/shared";

/** Placeholder bytes until desktop reads real archives from disk. */
export function getMockVaultArchiveBytes(vault: VaultRow): Uint8Array {
  const header = `[Upriv mock vault archive]\n${vault.id}\n${vault.displayName}\n${vault.persistence}\n`;
  return new TextEncoder().encode(header);
}
