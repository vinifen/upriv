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

/**
 * Screens of the vault settings window. Each has its own footer action: Save,
 * Change password (or Finish), or Change unlock RAM.
 */
const VAULT_SETTINGS_AREAS = ["preferences", "password", "kdf", "group"] as const;

export type VaultSettingsAreaId = (typeof VAULT_SETTINGS_AREAS)[number];

/**
 * Entries of a vault row's Settings menu: the settings screens, then Delete
 * vault, which opens a window of its own outside vault settings.
 */
export type VaultSettingsMenuEntry = VaultSettingsAreaId | "delete";

export const VAULT_SETTINGS_MENU_I18N = {
  preferences: "modal.settings.area.preferences",
  password: "modal.settings.area.password",
  kdf: "modal.settings.area.kdf",
  group: "modal.settings.area.group",
  delete: "modal.delete_vault.title",
} as const satisfies Record<VaultSettingsMenuEntry, I18nKey>;

export function vaultSettingsAreaTitleKey(area: VaultSettingsAreaId): I18nKey {
  return VAULT_SETTINGS_MENU_I18N[area];
}

/**
 * The Settings menu of a vault row. Password and unlock RAM need a closed
 * vault (`action.change_password` / `action.change_kdf`). Open, recovery, and
 * a pipeline omit those two entries. The mode does not: both storage modes
 * unlock `store/` with the same password and unlock RAM.
 * The change already running stays in the menu so that screen can reopen
 * and show its progress. Delete vault is always last; its window says when a
 * delete must wait. A vault being deleted offers that window alone, so it can
 * reopen with its progress or Continue.
 */
export function vaultSettingsMenuEntries(
  vault: VaultRow,
  pipeline: VaultPipelineListStatus = {},
): readonly VaultSettingsMenuEntry[] {
  if (resolveVaultListStatus(vault, pipeline) === "deleting") return ["delete"];
  const changesAllowed =
    vaultConfigEditAllowed("action.change_password", vault, pipeline) &&
    vaultConfigEditAllowed("action.change_kdf", vault, pipeline);
  const inFlight = pipeline.passwordChangeVaultIds?.includes(vault.id)
    ? "password"
    : pipeline.kdfChangeVaultIds?.includes(vault.id)
      ? "kdf"
      : null;
  const areas = VAULT_SETTINGS_AREAS.filter(
    (area) => changesAllowed || (area !== "password" && area !== "kdf") || area === inFlight,
  );
  return [...areas, "delete"];
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
  /**
   * Settings gear. Open during a password or unlock-RAM change, and a delete,
   * so that window can reopen with its progress.
   */
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
  "recovering",
]);

/**
 * `vault_config_save` returns `vault_busy` while export, a backup, or a
 * password or unlock-RAM change holds the vault, and `vault_deleting` once a
 * delete began. Removing a leftover folder ends with the folder gone, so its
 * folder and mode wait too.
 */
const CONFIG_WRITE_BLOCKED = new Set<VaultDisplayStatus>([
  "exporting",
  "backing_up",
  "recovering",
  "changing_password",
  "changing_kdf",
  "deleting",
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
export const VAULT_SETTINGS_MENU_ICON = {
  preferences: "settings",
  password: "lock",
  kdf: "cpu",
  group: "layers",
  delete: "trash",
} as const satisfies Record<VaultSettingsMenuEntry, IconName>;

/** Config-only sections grouped under Preferences. */
export function vaultSettingsPreferenceSections(
  mode: StorageMode,
): readonly VaultSettingsSectionId[] {
  return vaultSettingsSectionsForStorage(mode);
}
