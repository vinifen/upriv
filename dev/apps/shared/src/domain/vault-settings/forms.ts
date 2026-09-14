import { configEditGateAllows } from "../edit-policy/policy";
import type { VaultDisplayStatus } from "../vault/types";
import { kdfPresetIsDowngrade, type KdfUnlockPreset } from "./kdf";

export interface ChangePasswordFieldsState {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export const EMPTY_CHANGE_PASSWORD_FIELDS: ChangePasswordFieldsState = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

export interface ChangeKdfFieldsState {
  password: string;
  nextPreset: KdfUnlockPreset;
}

export function changePasswordFormIsDirty(fields: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): boolean {
  return (
    fields.currentPassword.length > 0 ||
    fields.newPassword.length > 0 ||
    fields.confirmPassword.length > 0
  );
}

export function changePasswordFormCanSubmit(fields: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  /** Rewrap requires `vault_closed` (recovery blocked). */
  vaultListStatus: VaultDisplayStatus;
  submitting?: boolean;
}): boolean {
  if (fields.submitting) return false;
  if (!configEditGateAllows("vault_closed", { vaultStatus: fields.vaultListStatus })) {
    return false;
  }
  const passwordsMatch =
    fields.newPassword.length > 0 && fields.newPassword === fields.confirmPassword;
  return (
    fields.currentPassword.length > 0 &&
    fields.newPassword.length > 0 &&
    passwordsMatch &&
    fields.newPassword !== fields.currentPassword
  );
}

/** Unlock cost always comes from `contents/vault.header` (never `config.toml`). */
export function changeKdfFormIsDirty(fields: {
  password: string;
  nextPreset: KdfUnlockPreset;
  currentPreset: KdfUnlockPreset;
}): boolean {
  if (fields.password.length > 0) return true;
  return fields.nextPreset !== fields.currentPreset;
}

export function changeKdfFormCanSubmit(fields: {
  password: string;
  nextPreset: KdfUnlockPreset;
  currentPreset: KdfUnlockPreset;
  /** Rewrap requires `vault_closed`. */
  vaultListStatus: VaultDisplayStatus;
  submitting?: boolean;
}): boolean {
  if (fields.submitting) return false;
  if (!configEditGateAllows("vault_closed", { vaultStatus: fields.vaultListStatus })) {
    return false;
  }
  if (fields.password.length === 0) return false;
  return fields.nextPreset !== fields.currentPreset;
}

export function changeKdfFormIsDowngrade(
  currentPreset: KdfUnlockPreset,
  nextPreset: KdfUnlockPreset,
): boolean {
  return nextPreset !== currentPreset && kdfPresetIsDowngrade(currentPreset, nextPreset);
}
