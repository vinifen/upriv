import type { VaultRow } from "./types";
import { resolveVaultDisplayStatus, storageModeIsPlaintext } from "./types";
import type { SecurityMode } from "../vault-settings/types";
import { securityModeToUi } from "../vault-settings/types";

export type VaultLifecycleIntent = "unlock" | "close";

export interface VaultLifecycleRequest {
  vaultId: string;
  intent: VaultLifecycleIntent;
}

/** Whether idle auto-close can run without prompting the user. */
export function canRunIdleAutoClose(vault: VaultRow, securityMode: SecurityMode): boolean {
  return !requiresPasswordForLifecycle(vault, "close", securityMode);
}

/**
 * Close uses session keys already in RAM (or `session.enc`). The password string
 * is only required to unlock, or as an opt-in presence check (`always_prompt`).
 * A typed close password must never rewrap `vault.header`.
 */
export function requiresPasswordForLifecycle(
  vault: VaultRow,
  intent: VaultLifecycleIntent,
  securityMode: SecurityMode,
): boolean {
  if (intent === "unlock") return true;

  const status = resolveVaultDisplayStatus(vault);
  if (status !== "open") return false;

  return securityModeToUi(securityMode) === "prompt_open_close";
}

/**
 * Show a lock dialog: password presence-check (`always_prompt`) and/or wipe
 * confirm for `upriv_plain`. Default `encrypted_dir` lock starts the pipeline.
 */
export function requiresCloseDialog(vault: VaultRow, securityMode: SecurityMode): boolean {
  if (requiresPasswordForLifecycle(vault, "close", securityMode)) return true;
  return storageModeIsPlaintext(vault.storageMode) && resolveVaultDisplayStatus(vault) === "open";
}
