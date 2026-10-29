import type { I18nKey } from "../../i18n/catalog";
import { vaultConfigEditAllowed } from "../edit-policy";
import type { IconName } from "../icons";
import {
  resolveVaultListStatus,
  type StorageMode,
  type VaultDisplayStatus,
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
 * Gear-menu screens. Password and unlock RAM need a closed vault
 * (`action.change_password` / `action.change_kdf`). Open, recovery, and a
 * pipeline omit those two entries. The mode does not: both storage modes
 * unlock `store/` with the same password and unlock RAM.
 * The one rewrap already running stays in the menu so that screen can reopen
 * and show the same countdown.
 */
export function vaultSettingsMenuAreas(
  vault: VaultRow,
  pipeline: VaultPipelineListStatus = {},
): readonly VaultSettingsAreaId[] {
  const rewrapAllowed =
    vaultConfigEditAllowed("action.change_password", vault, pipeline) &&
    vaultConfigEditAllowed("action.change_kdf", vault, pipeline);
  if (rewrapAllowed) return VAULT_SETTINGS_AREAS;
  const inFlight = pipeline.passwordChangeVaultIds?.includes(vault.id)
    ? "password"
    : pipeline.kdfChangeVaultIds?.includes(vault.id)
      ? "kdf"
      : null;
  return VAULT_SETTINGS_AREAS.filter((area) => {
    if (area !== "password" && area !== "kdf") return true;
    return area === inFlight;
  });
}

/** Which row controls are closed for this vault's list status. */
export type VaultRowControls = {
  /** ⋯ menu. Closed for opening, creating, and queued. Open while closing. */
  moreMenuBlocked: boolean;
  /** Note autosave, and the Note item while the menu itself is closed. */
  noteBlocked: boolean;
  /**
   * Note is left out of the ⋯ menu: export, a backup, or a password / unlock-RAM
   * change refuses the write, as Export is left out when it cannot run. While
   * the whole menu is closed it stays, greyed with the rest.
   */
  noteHidden: boolean;
  /** Settings gear. Open during a password or unlock-RAM change so that countdown can reopen. */
  settingsGearBlocked: boolean;
  /** Settings Save, including a screen that was already open. */
  settingsSaveBlocked: boolean;
  /** Drag handle and the order write. Same statuses as Save: a reorder is a config write. */
  dragBlocked: boolean;
};

const MORE_MENU_BLOCKED = new Set<VaultDisplayStatus>(["opening", "creating", "queued"]);

const SETTINGS_GEAR_BLOCKED = new Set<VaultDisplayStatus>([
  "opening",
  "creating",
  "queued",
  "closing",
  "exporting",
  "backing_up",
]);

/** `vault_config_save` returns `vault_busy` while export, a backup, or rewrap holds the vault. */
const CONFIG_WRITE_BLOCKED = new Set<VaultDisplayStatus>([
  "exporting",
  "backing_up",
  "changing_password",
  "changing_kdf",
]);

export function vaultRowControls(
  vault: VaultRow,
  pipeline: VaultPipelineListStatus = {},
): VaultRowControls {
  const status = resolveVaultListStatus(vault, pipeline);
  const moreMenuBlocked = MORE_MENU_BLOCKED.has(status);
  const configWriteBlocked = CONFIG_WRITE_BLOCKED.has(status);
  const settingsGearBlocked = SETTINGS_GEAR_BLOCKED.has(status);
  const settingsSaveBlocked = settingsGearBlocked || configWriteBlocked;
  return {
    moreMenuBlocked,
    noteBlocked: moreMenuBlocked || configWriteBlocked,
    noteHidden: configWriteBlocked,
    settingsGearBlocked,
    settingsSaveBlocked,
    dragBlocked: settingsSaveBlocked,
  };
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
