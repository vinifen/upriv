import { storageModeHasPortableArchive, type VaultRow } from "../vault/types";

/** Main archive name under `vaults/<id>/archive/` (Plan B — display name verbatim). */
export function vaultArchiveFilename(vault: Pick<VaultRow, "displayName">): string {
  return `${vault.displayName}.7z`;
}

/** Zip entry path — vault id folder avoids display-name collisions. */
export function vaultArchiveZipEntryPath(vault: VaultRow): string {
  return `${vault.id}/${vaultArchiveFilename(vault)}`;
}

/** No portable `.7z` (Upriv-only) or an in-flight session that may leave a stale archive. */
export function vaultBlocksBulkExport(vault: VaultRow): boolean {
  if (!storageModeHasPortableArchive(vault.storageMode)) return true;
  return vault.session === "open" || vault.session === "closing" || vault.session === "recovery";
}

/** Open / closing / recovery vaults that still have a `.7z` to export after lock. */
export function listVaultsBlockingBulkExport(vaults: readonly VaultRow[]): VaultRow[] {
  return vaults.filter(
    (vault) =>
      storageModeHasPortableArchive(vault.storageMode) &&
      (vault.session === "open" || vault.session === "closing" || vault.session === "recovery"),
  );
}

export function listVaultsReadyForBulkExport(vaults: readonly VaultRow[]): VaultRow[] {
  return vaults.filter((vault) => !vaultBlocksBulkExport(vault));
}
