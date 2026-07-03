import type { VaultRow, StorageMode } from "./types";
import { resolveVaultDisplayStatus } from "./types";
import type { CloseDefaultAction, SecurityMode } from "../vault-settings";
import { securityModeToUi } from "../vault-settings";

export type VaultLifecycleIntent = "unlock" | "close" | "seal";

export interface VaultLifecycleRequest {
  vaultId: string;
  intent: VaultLifecycleIntent;
}

/** Idle timeout action — plain vaults always seal; encrypted_dir follows close default. */
export function resolveIdleAutoCloseIntent(
  storageMode: StorageMode,
  closeDefaultAction: CloseDefaultAction,
): Extract<VaultLifecycleIntent, "close" | "seal"> {
  return storageMode === "plain" || closeDefaultAction === "seal" ? "seal" : "close";
}

/** Whether idle auto-close/seal can run without prompting the user for a password. */
export function canRunIdleAutoClose(
  vault: VaultRow,
  storageMode: StorageMode,
  securityMode: SecurityMode,
  closeDefaultAction: CloseDefaultAction,
  hasPasswordInRam: boolean,
): boolean {
  const intent = resolveIdleAutoCloseIntent(storageMode, closeDefaultAction);
  return !requiresPasswordForLifecycle(vault, intent, securityMode, hasPasswordInRam);
}

/** Password only for unlock, or close/seal while the vault is still open without RAM. */
export function requiresPasswordForLifecycle(
  vault: VaultRow,
  intent: VaultLifecycleIntent,
  securityMode: SecurityMode,
  hasPasswordInRam: boolean,
  hasDiskSession = false,
): boolean {
  if (intent === "unlock") {
    if (securityModeToUi(securityMode) === "disk_open_close" && hasDiskSession) {
      return false;
    }
    return true;
  }

  const status = resolveVaultDisplayStatus(vault);
  if (intent === "seal" && status === "closed") return false;
  if (status !== "open") return false;

  const uiMode = securityModeToUi(securityMode);
  switch (uiMode) {
    case "prompt_open_close":
      return true;
    case "disk_open_close":
      return false;
    case "session_ram":
    case "disk_close":
    default:
      return !hasPasswordInRam;
  }
}
