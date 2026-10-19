import type { VaultRow } from "./types";
import { resolveVaultDisplayStatus } from "./types";

export type VaultLifecycleIntent = "unlock" | "close";

/**
 * The unlock password dialog for one vault. Lock never opens a dialog: it
 * starts the close at once, since a plaintext folder was checked at open.
 */
export interface VaultLifecycleRequest {
  vaultId: string;
}

/**
 * Idle auto-close runs for every open vault, including `upriv_plain`.
 * The lock is the normal close, so plaintext wipes its folder.
 */
export function canRunIdleAutoClose(vault: VaultRow): boolean {
  return resolveVaultDisplayStatus(vault) === "open";
}
