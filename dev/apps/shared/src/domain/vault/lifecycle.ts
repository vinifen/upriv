import type { VaultRow } from "./types";
import { resolveVaultDisplayStatus } from "./types";

export type VaultLifecycleIntent = "unlock" | "close";

export interface VaultLifecycleRequest {
  vaultId: string;
  intent: VaultLifecycleIntent;
}

/**
 * Idle auto-close runs for every open vault, including `upriv_plain`.
 * The lock is the normal close, so plaintext wipes its folder.
 * The folder was already checked when the vault opened, so lock does not ask again.
 */
export function canRunIdleAutoClose(vault: VaultRow): boolean {
  return resolveVaultDisplayStatus(vault) === "open";
}

/** Lock starts the close immediately. The folder check already happened at open. */
export function requiresCloseDialog(_vault: VaultRow): boolean {
  return false;
}
