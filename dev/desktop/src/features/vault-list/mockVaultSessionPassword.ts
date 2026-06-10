import type { VaultListItem } from "./types";
import type { VaultLifecycleIntent } from "./vaultLifecycleTypes";
import { resolveVaultDisplayStatus } from "@/types";

/** Mock: vault passwords held in session RAM after unlock (until close/seal). */
const vaultPasswordInRam = new Map<string, string>();

export function hasVaultPasswordInRam(vaultId: string): boolean {
  return vaultPasswordInRam.has(vaultId);
}

export function getVaultPasswordInRam(vaultId: string): string | undefined {
  return vaultPasswordInRam.get(vaultId);
}

export function setVaultPasswordInRam(vaultId: string, password = "demo"): void {
  vaultPasswordInRam.set(vaultId, password.trim());
}

export function clearVaultPasswordInRam(vaultId: string): void {
  vaultPasswordInRam.delete(vaultId);
}

/** Demo validation until Tauri `vault_unlock` / `vault_close`. */
export function validateMockVaultPassword(password: string): boolean {
  const trimmed = password.trim();
  return trimmed.length > 0 && trimmed !== "wrong";
}

/** Password only for unlock, or close/seal while the vault is still open without RAM. */
export function requiresPasswordForLifecycle(
  vault: VaultListItem,
  intent: VaultLifecycleIntent,
): boolean {
  if (intent === "unlock") return true;

  const status = resolveVaultDisplayStatus(vault);
  if (intent === "seal" && status === "closed") return false;

  return status === "open" && !hasVaultPasswordInRam(vault.id);
}
