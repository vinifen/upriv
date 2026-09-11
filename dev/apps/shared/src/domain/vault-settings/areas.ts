import type { I18nKey } from "../../i18n/catalog";
import type { IconName } from "../icons";
import type { StorageMode } from "../vault/types";
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
