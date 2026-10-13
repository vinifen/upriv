import type { I18nKey } from "../../i18n/catalog";
import { vaultConfigEditAllowed } from "../edit-policy";
import type { IconName } from "../icons";
import {
  storageModeIsPlaintext,
  type StorageMode,
  type VaultPipelineListStatus,
  type VaultRow,
} from "../vault/types";
import { vaultSettingsSectionsForStorage, type VaultSettingsSectionId } from "./types";

/** Top-level vault settings screens (each has its own footer Save). */
export const VAULT_SETTINGS_AREAS = ["preferences", "password", "kdf", "group"] as const;

export type VaultSettingsAreaId = (typeof VAULT_SETTINGS_AREAS)[number];

export const VAULT_SETTINGS_AREA_I18N = {
  preferences: "modal.settings.area.preferences",
  password: "modal.settings.area.password",
  kdf: "modal.settings.area.kdf",
  group: "modal.settings.area.group",
} as const satisfies Record<VaultSettingsAreaId, I18nKey>;

export function vaultSettingsAreaTitleKey(area: VaultSettingsAreaId): I18nKey {
  return VAULT_SETTINGS_AREA_I18N[area];
}

/**
 * Gear-menu screens. Password and unlock RAM need a closed encrypted vault
 * (`action.change_password` / `action.change_kdf`). Open, recovery, pipeline,
 * and `upriv_plain` omit those two entries.
 */
export function vaultSettingsMenuAreas(
  vault: VaultRow,
  pipeline: VaultPipelineListStatus = {},
): readonly VaultSettingsAreaId[] {
  const rewrapAllowed =
    !storageModeIsPlaintext(vault.storageMode) &&
    vaultConfigEditAllowed("action.change_password", vault, pipeline) &&
    vaultConfigEditAllowed("action.change_kdf", vault, pipeline);
  if (rewrapAllowed) return VAULT_SETTINGS_AREAS;
  return VAULT_SETTINGS_AREAS.filter((area) => area !== "password" && area !== "kdf");
}

/** Glyph names shared by desktop and mobile `Icon` catalogs. */
export const VAULT_SETTINGS_AREA_ICON = {
  preferences: "settings",
  password: "lock",
  kdf: "cpu",
  group: "layers",
} as const satisfies Record<VaultSettingsAreaId, IconName>;

/** Config-only sections grouped under Preferences. */
export function vaultSettingsPreferenceSections(
  mode: StorageMode,
): readonly VaultSettingsSectionId[] {
  return vaultSettingsSectionsForStorage(mode);
}
