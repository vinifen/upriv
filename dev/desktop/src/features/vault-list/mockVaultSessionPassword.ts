/**
 * Mock-only vault password session (prototype UI).
 * Replace with Tauri → upriv-core session handle before real crypto.
 */
import type { VaultListItem } from "./types";
import type { VaultLifecycleIntent } from "./vaultLifecycleTypes";
import { resolveVaultDisplayStatus } from "@/types";
import { getMockVaultSettings } from "./mockVaultSettings";
import { securityModeToUi, type SecurityUiMode } from "./vaultSettingsTypes";

const vaultPasswordInRam = new Map<string, string>();
const seededOpenVaultIds = new Set<string>();

export function hasVaultPasswordInRam(vaultId: string): boolean {
  return vaultPasswordInRam.has(vaultId);
}

export function getVaultPasswordInRam(vaultId: string): string | undefined {
  return vaultPasswordInRam.get(vaultId);
}

export function setVaultPasswordInRam(vaultId: string, password: string): void {
  vaultPasswordInRam.set(vaultId, password.trim());
}

export function clearVaultPasswordInRam(vaultId: string): void {
  vaultPasswordInRam.delete(vaultId);
}

/** One-time demo seed for mock rows that start open (does not overwrite unlock passwords). */
export function seedInitialOpenVaultPasswords(openVaultIds: readonly string[]): void {
  for (const vaultId of openVaultIds) {
    if (seededOpenVaultIds.has(vaultId)) continue;
    if (!vaultPasswordInRam.has(vaultId)) {
      vaultPasswordInRam.set(vaultId, "demo");
    }
    seededOpenVaultIds.add(vaultId);
  }
}

/**
 * Demo validation until Tauri `vault_unlock` / `vault_close`.
 * Any non-empty password works except the literal `wrong` (see VaultChangePasswordPanel).
 * Pre-open vaults are seeded with `demo` via `seedInitialOpenVaultPasswords`.
 */
export function validateMockVaultPassword(password: string): boolean {
  const trimmed = password.trim();
  return trimmed.length > 0 && trimmed !== "wrong";
}

function securityUiModeForVault(vaultId: string): SecurityUiMode {
  return securityModeToUi(getMockVaultSettings(vaultId).security.mode);
}

/** Password only for unlock, or close/seal while the vault is still open without RAM. */
export function requiresPasswordForLifecycle(
  vault: VaultListItem,
  intent: VaultLifecycleIntent,
): boolean {
  if (intent === "unlock") return true;

  const status = resolveVaultDisplayStatus(vault);
  if (intent === "seal" && status === "closed") return false;
  if (status !== "open") return false;

  const uiMode = securityUiModeForVault(vault.id);
  switch (uiMode) {
    case "prompt_open_close":
      return true;
    case "disk_open_close":
      return false;
    case "session_ram":
    case "disk_close":
    default:
      return !hasVaultPasswordInRam(vault.id);
  }
}
