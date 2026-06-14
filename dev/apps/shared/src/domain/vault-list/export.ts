import type { VaultRow } from "../vault/types";

/** Main archive name under `vaults/<id>/archive/` (Plan B — display name verbatim). */
export function vaultArchiveFilename(vault: Pick<VaultRow, "displayName">): string {
  return `${vault.displayName}.7z`;
}

/** Zip entry path — vault id folder avoids display-name collisions. */
export function vaultArchiveZipEntryPath(vault: VaultRow): string {
  return `${vault.id}/${vaultArchiveFilename(vault)}`;
}

/** Open / closing / recovery sessions may have a stale `.7z` on disk. */
export function vaultBlocksBulkExport(vault: VaultRow): boolean {
  return vault.session === "open" || vault.session === "closing" || vault.session === "recovery";
}

export function listVaultsBlockingBulkExport(vaults: readonly VaultRow[]): VaultRow[] {
  return vaults.filter(vaultBlocksBulkExport);
}

export function listVaultsReadyForBulkExport(vaults: readonly VaultRow[]): VaultRow[] {
  return vaults.filter((vault) => !vaultBlocksBulkExport(vault));
}
