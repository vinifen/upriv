import type { VaultPipelineListStatus, VaultRow } from "../vault/types";
import { vaultCanExport } from "../vault-list/export";

/**
 * Backups → Back up now zips the vault's `store/` while nothing writes to it, the
 * same closed, idle vault a store-zip export needs. An open session, recovery,
 * and any open, close, create, export, backup, or rewrap of this vault keep it
 * disabled.
 */
export function vaultCanSaveBackupNow(
  vault: Pick<VaultRow, "id" | "session">,
  pipeline: VaultPipelineListStatus = {},
): boolean {
  return vaultCanExport(vault, pipeline);
}
