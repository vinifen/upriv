import { TAURI_COMMANDS, tauriInvoke } from "@/lib/tauri";
import { resolveVaultRootPath } from "./vaultRoot";
import type { RecoveryAction } from "@/features/vaults/lifecycle/modals/VaultRecoveryModal";

export interface RecoveryInfoDto {
  needsRecovery: boolean;
  manifestArchiveHash: string;
  actualArchiveHash: string;
  manifestStoreHash?: string;
  actualStoreHash?: string;
  lastCloseOkAt?: string;
  lastStoreWriteAt?: string;
  syncGeneration: number;
  orphanWorkspace: boolean;
  archiveHashMismatch: boolean;
  storeHashMismatch: boolean;
  storeAheadOfClose: boolean;
}

export async function assessVaultRecovery(vaultId: string): Promise<RecoveryInfoDto> {
  const vaultRoot = await resolveVaultRootPath();
  return tauriInvoke<RecoveryInfoDto>(TAURI_COMMANDS.VAULT_RECOVERY_ASSESS, {
    vaultRoot,
    vaultId,
  });
}

export async function resolveVaultRecovery(
  vaultId: string,
  password: string,
  action: RecoveryAction,
): Promise<void> {
  const vaultRoot = await resolveVaultRootPath();
  await tauriInvoke(TAURI_COMMANDS.VAULT_RECOVERY_RESOLVE, {
    vaultRoot,
    vaultId,
    password,
    action,
  });
}

/** Short hash label for the compare view (`sha256:abc…def`). */
export function shortHashLabel(hash: string): string {
  const value = hash.startsWith("sha256:") ? hash.slice(7) : hash;
  if (value.length <= 12) return value || "—";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
