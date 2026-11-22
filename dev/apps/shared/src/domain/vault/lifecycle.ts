import type { UnlockedDestination } from "../vault-unlocked/types";
import type { VaultRow } from "./types";
import { resolveVaultDisplayStatus } from "./types";

export type VaultLifecycleIntent = "unlock" | "close";

/**
 * The unlock password dialog for one vault. Lock never opens a dialog: it
 * starts the close at once, since a plaintext folder was checked at open.
 */
export interface VaultLifecycleRequest {
  vaultId: string;
  /**
   * Where the files will appear, when the step before the window already
   * looked it up (a plain-text vault's). Absent, the window looks it up.
   */
  destination?: UnlockedDestination;
}

/**
 * Idle auto-close runs for every open vault, including `upriv_plain`.
 * The lock is the normal close, so plaintext wipes its folder.
 */
export function canRunIdleAutoClose(vault: VaultRow): boolean {
  return resolveVaultDisplayStatus(vault) === "open";
}
