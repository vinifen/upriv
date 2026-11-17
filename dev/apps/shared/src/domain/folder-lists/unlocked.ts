import { isPhoneSystem } from "../device";
import { selectionHere, type HereDevice } from "./edits";
import {
  APP_UNLOCKED_LIST,
  NOTHING_SELECTED,
  VAULT_UNLOCKED_LIST,
  type AppUnlockedFolders,
  type VaultUnlockedFolder,
} from "./types";

/**
 * Whether an encrypted vault gets an unlocked folder (core
 * `encrypted_folder_on`). `vault` is `null` for a vault that follows the app.
 */
export function encryptedFolderOn(
  app: AppUnlockedFolders,
  vault: VaultUnlockedFolder | null,
): boolean {
  const encrypted = vault?.encrypted ?? "inherit";
  return encrypted === "on" || (encrypted === "inherit" && app.encrypted_vaults);
}

/**
 * On this device an encrypted vault should get an unlocked folder, and no
 * folder is chosen: its own list uses the app's, and the app's selects
 * nothing, so the vault opens in Upriv only (core answers `unset`). `vault`
 * is `null` for a vault that follows the app. Never on a phone, which mounts
 * no encrypted vault's folder.
 */
export function encryptedFolderUnchosen(
  app: AppUnlockedFolders,
  vault: VaultUnlockedFolder | null,
  here: HereDevice | null,
): boolean {
  if (!here || isPhoneSystem(here.system) || !encryptedFolderOn(app, vault)) return false;
  if (vault && typeof selectionHere(vault.devices, here.id, VAULT_UNLOCKED_LIST) === "number") {
    return false;
  }
  return selectionHere(app.devices, here.id, APP_UNLOCKED_LIST) === NOTHING_SELECTED;
}
