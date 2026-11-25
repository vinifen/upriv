import { configEditGateAllows } from "../edit-policy/policy";
import type { VaultDisplayStatus } from "../vault/types";
import { kdfPresetIsDowngrade, type KdfUnlockPreset } from "./kdf";
import type { VaultStorage } from "./types";

export interface ChangePasswordFieldsState {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  /** The vault's hint once the change is made; empty for none. Optional. */
  passwordHint: string;
}

export const EMPTY_CHANGE_PASSWORD_FIELDS: ChangePasswordFieldsState = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
  passwordHint: "",
};

export interface ChangeKdfFieldsState {
  password: string;
  nextPreset: KdfUnlockPreset;
}

export function changePasswordFormIsDirty(fields: ChangePasswordFieldsState): boolean {
  return (
    fields.currentPassword.length > 0 ||
    fields.newPassword.length > 0 ||
    fields.confirmPassword.length > 0 ||
    fields.passwordHint.length > 0
  );
}

export function changePasswordFormCanSubmit(fields: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  /** A password change requires `vault_closed` (recovery blocked). */
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

/** Unlock cost always comes from `store/header/vault.header` (never `config.toml`). */
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
  /** An unlock-RAM change requires `vault_closed`. */
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

export interface ChangeStorageFieldsState {
  password: string;
  storage: VaultStorage;
}

function sameStorage(a: VaultStorage, b: VaultStorage): boolean {
  return a.mode === b.mode && a.plain_files === b.plain_files;
}

/** The Storage screen starts from `config.toml`'s copy, the value the vault list shows. */
export function changeStorageFormIsDirty(fields: {
  password: string;
  storage: VaultStorage;
  current: VaultStorage;
}): boolean {
  return fields.password.length > 0 || !sameStorage(fields.storage, fields.current);
}

export function changeStorageFormCanSubmit(fields: {
  password: string;
  storage: VaultStorage;
  current: VaultStorage;
  /** A Storage change requires `vault_closed`. */
  vaultListStatus: VaultDisplayStatus;
  submitting?: boolean;
}): boolean {
  if (fields.submitting) return false;
  if (!configEditGateAllows("vault_closed", { vaultStatus: fields.vaultListStatus })) {
    return false;
  }
  return fields.password.length > 0 && !sameStorage(fields.storage, fields.current);
}

export function changeKdfFormIsDowngrade(
  currentPreset: KdfUnlockPreset,
  nextPreset: KdfUnlockPreset,
): boolean {
  return nextPreset !== currentPreset && kdfPresetIsDowngrade(currentPreset, nextPreset);
}
