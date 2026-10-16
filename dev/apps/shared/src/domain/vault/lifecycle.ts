import type { VaultRow } from "./types";
import { resolveVaultDisplayStatus, storageModeIsPlaintext } from "./types";

export type VaultLifecycleIntent = "unlock" | "close";

export interface VaultLifecycleRequest {
  vaultId: string;
  intent: VaultLifecycleIntent;
}

/**
 * Idle auto-close runs for every open vault, including a future `upriv_plain`
 * session. The lock is the normal close, so plaintext wipes its folder.
 * Callers must not consult `requiresCloseDialog` — that confirm is only for a
 * manual lock.
 */
export function canRunIdleAutoClose(vault: VaultRow): boolean {
  return resolveVaultDisplayStatus(vault) === "open";
}

/**
 * Show a lock dialog only to confirm wiping an open `upriv_plain` folder.
 * Encrypted lock starts the pipeline immediately.
 */
export function requiresCloseDialog(vault: VaultRow): boolean {
  return storageModeIsPlaintext(vault.storageMode) && resolveVaultDisplayStatus(vault) === "open";
}
