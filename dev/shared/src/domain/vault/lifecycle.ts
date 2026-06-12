import type { VaultRow } from "./types";
import { resolveVaultDisplayStatus } from "./types";
import type { SecurityMode } from "../vault-settings";
import { securityModeToUi } from "../vault-settings";

export type VaultLifecycleIntent = "unlock" | "close" | "seal";

/** Password only for unlock, or close/seal while the vault is still open without RAM. */
export function requiresPasswordForLifecycle(
  vault: VaultRow,
  intent: VaultLifecycleIntent,
  securityMode: SecurityMode,
  hasPasswordInRam: boolean,
): boolean {
  if (intent === "unlock") return true;

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
