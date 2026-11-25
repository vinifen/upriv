import { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import {
  APP_BACKUP_LIST,
  APP_UNLOCKED_LIST,
  ENCRYPTED_FOLDER_SWITCHES,
  VAULT_BACKUP_LIST,
  VAULT_UNLOCKED_LIST,
  besideFolder,
  dataFolderBackupsFolder,
  folderStatusLine,
  selectionFolder,
  selectionHere,
  selectionLabel,
  type AppBackupFolders,
  type AppUnlockedFolders,
  type DeviceGroups,
  type FolderRow,
  type HereDevice,
  type VaultBackupChoice,
  type VaultUnlockedChoice,
  type VaultUnlockedFolder,
} from "@upriv/shared";
import { useDataFolderPath, useFolderStatuses } from "@upriv/shared/react";
import { FolderList, StatusLine, shownPath } from "@/components/folder-list";
import { PolicyRadioOption } from "@/components/settings/PolicyRadioOption";
import { FieldHint, FieldLabel, RadioGroup } from "@/components/settings/settingsFields";
import { useTranslation } from "@/i18n";
import { useFolderListService, useVaultRootService } from "@/platform/services";
import { spacing } from "@/theme/tokens";

/**
 * Each row's status line in an unlocked folder or backup list, checked on its
 * own, and the vaults open in a row's folder now (`openIn`), which keep that
 * row in the list.
 */
function useRowStatuses<F extends string>(
  list: "unlocked" | "backup",
  groups: DeviceGroups<F>,
  here: HereDevice | null,
  vaultId: string | null,
) {
  const { t } = useTranslation();
  const folderLists = useFolderListService();
  const paths = (here ? groups[here.id]?.rows : undefined)?.map((row) => row.path) ?? [];
  const check = useCallback(
    (path: string) => folderLists.status(list, path, vaultId),
    [folderLists, list, vaultId],
  );
  const { statuses } = useFolderStatuses(paths, check);
  const renderStatus = useCallback(
    (path: string) => {
      const key = path.trim();
      // A check that could not run leaves the row with no status line.
      if (!statuses.has(key)) return null;
      return <StatusLine line={folderStatusLine(statuses.get(key) ?? null, list, t)} />;
    },
    [list, statuses, t],
  );
  const openIn = useCallback(
    (path: string): readonly string[] => statuses.get(path.trim())?.details?.openVaults ?? [],
    [statuses],
  );
  return { renderStatus, openIn };
}

/** A folder of this phone: a storage-access grant from the system picker. */
function usePickFolder() {
  const { t } = useTranslation();
  const vaultRoot = useVaultRootService();
  return useCallback(
    () => vaultRoot.pickFolder(null, t("modal.app_settings.action.choose_folder")),
    [t, vaultRoot],
  );
}

/**
 * The folders the fixed choices stand for on this phone, named as the Files
 * app names them; `null` until the data folder in use answers.
 */
function useFixedFolders(here: HereDevice | null, vaultId: string | null) {
  const dataFolder = useDataFolderPath(useVaultRootService());
  if (!here || !dataFolder) return { beside: null, dataFolderBackups: null };
  return {
    beside: besideFolder(here.system, dataFolder),
    dataFolderBackups: dataFolderBackupsFolder(here.system, dataFolder, vaultId),
  };
}

/** A folder as a fixed choice shows it. */
function shownFolder(folder: string | null): string | null {
  return folder ? shownPath(folder) : null;
}

/**
 * Where open vaults' files appear on this phone for every vault that follows
 * the app's list. A phone mounts no encrypted vault's folder: its switch
 * shows, unavailable, and only plain-text vaults use the folders.
 */
export function AppUnlockedFoldersSection({
  config,
  saved,
  here,
  lockedHint = null,
  onChange,
}: {
  config: AppUnlockedFolders;
  /** As loaded: a row loaded as it is keeps its path unchecked. */
  saved: AppUnlockedFolders;
  here: HereDevice | null;
  /** Why this device's group cannot change now (a vault is open); `null` when it can. */
  lockedHint?: string | null;
  onChange: (patch: Partial<AppUnlockedFolders>) => void;
}) {
  const { t } = useTranslation();
  const { renderStatus } = useRowStatuses("unlocked", config.devices, here, null);
  const pickFolder = usePickFolder();
  const folders = useFixedFolders(here, null);
  return (
    <View style={styles.fields}>
      <View style={styles.fieldGroup}>
        <FieldLabel disabled>{t("modal.app_settings.field.encrypted_vaults")}</FieldLabel>
        <FieldHint disabled>{t("modal.settings.field.unlocked_folder.phone")}</FieldHint>
        <RadioGroup>
          {(["on", "off"] as const).map((value) => (
            <PolicyRadioOption
              key={value}
              value={value}
              checked={config.encrypted_vaults === (value === "on")}
              disabled
              title={t(`modal.settings.option.unlocked_folder.encrypted.${value}`)}
              description={t(`modal.settings.option.unlocked_folder.encrypted.${value}_app_desc`)}
              onSelect={() => undefined}
            />
          ))}
        </RadioGroup>
      </View>
      <View style={styles.fieldGroup}>
        <FieldLabel>{t("modal.app_settings.field.unlocked_folders.list")}</FieldLabel>
        <FieldHint>{t("modal.app_settings.field.unlocked_folders.list_help")}</FieldHint>
        <FolderList
          label={t("modal.app_settings.field.unlocked_folders.list")}
          policy={APP_UNLOCKED_LIST}
          groups={config.devices}
          saved={saved.devices}
          here={here}
          lockedHint={lockedHint}
          fixed={[
            {
              choice: "beside",
              title: t("folder_list.choice.beside"),
              description: t("modal.app_settings.field.unlocked_folders.beside_desc"),
              folder: shownFolder(folders.beside),
            },
          ]}
          renderStatus={renderStatus}
          pickFolder={pickFolder}
          onChange={(devices) => onChange({ devices })}
        />
      </View>
    </View>
  );
}

/** Where backups go on this phone for every vault that follows the app's list. */
export function AppBackupsSection({
  config,
  saved,
  here,
  onChange,
}: {
  config: AppBackupFolders;
  saved: AppBackupFolders;
  here: HereDevice | null;
  onChange: (patch: Partial<AppBackupFolders>) => void;
}) {
  const { t } = useTranslation();
  const { renderStatus } = useRowStatuses("backup", config.devices, here, null);
  const pickFolder = usePickFolder();
  const folders = useFixedFolders(here, null);
  return (
    <View style={styles.fields}>
      <FieldHint>{t("modal.app_settings.section.backups_intro")}</FieldHint>
      <FolderList
        label={t("modal.app_settings.section.backups")}
        policy={APP_BACKUP_LIST}
        groups={config.devices}
        saved={saved.devices}
        here={here}
        fixed={[
          {
            choice: "data_folder",
            title: t("folder_list.choice.data_folder"),
            description: t("modal.settings.field.backup.folder_data_desc"),
            folder: shownFolder(folders.dataFolderBackups),
          },
        ]}
        renderStatus={renderStatus}
        pickFolder={pickFolder}
        onChange={(devices) => onChange({ devices })}
      />
    </View>
  );
}

/**
 * The vault's unlocked folder on this phone: the encrypted switch (one for
 * every device, unavailable on a phone) and this phone's folders.
 */
export function VaultUnlockedFolderSection({
  config,
  saved,
  here,
  vaultId,
  appUnlocked,
  plaintext,
  lockedHint = null,
  onChange,
}: {
  config: VaultUnlockedFolder;
  /** This list as loaded; empty for a vault being created. */
  saved: DeviceGroups<VaultUnlockedChoice>;
  here: HereDevice | null;
  /** The vault's id; `null` while it is being created. */
  vaultId: string | null;
  /** The app's unlocked folders: what Use the app's means here. */
  appUnlocked: AppUnlockedFolders;
  /** A plain-text vault writes its files there: its switch shows, unavailable. */
  plaintext: boolean;
  lockedHint?: string | null;
  onChange: (patch: Partial<VaultUnlockedFolder>) => void;
}) {
  const { t } = useTranslation();
  const { renderStatus, openIn } = useRowStatuses("unlocked", config.devices, here, vaultId);
  const pickFolder = usePickFolder();
  const hereId = here?.id ?? null;
  // Core keeps a saved row while a vault is open in its folder: it may not
  // go or change its folder then.
  const savedRows = hereId ? (saved[hereId]?.rows ?? []) : [];
  const rowInUse = (row: FolderRow) =>
    savedRows.some((old) => old.number === row.number && old.path.trim() === row.path.trim()) &&
    openIn(row.path).length > 0;
  const appSelection = selectionHere(appUnlocked.devices, hereId, APP_UNLOCKED_LIST);
  const appGroup = hereId ? appUnlocked.devices[hereId] : undefined;
  const appChoice = selectionLabel(appSelection, appGroup, t);
  const folders = useFixedFolders(here, vaultId);
  const appFolder = selectionFolder(appSelection, appGroup, () => folders.beside);
  return (
    <View style={styles.fields}>
      <View style={styles.fieldGroup}>
        <FieldLabel disabled>{t("modal.settings.field.unlocked_folder.encrypted")}</FieldLabel>
        <FieldHint disabled>
          {t(
            plaintext
              ? "modal.settings.field.unlocked_folder.plain"
              : "modal.settings.field.unlocked_folder.phone",
          )}
        </FieldHint>
        <RadioGroup>
          {ENCRYPTED_FOLDER_SWITCHES.map((value) => (
            <PolicyRadioOption
              key={value}
              value={value}
              checked={config.encrypted === value}
              disabled
              title={t(`modal.settings.option.unlocked_folder.encrypted.${value}`, {
                state: t(
                  appUnlocked.encrypted_vaults
                    ? "modal.settings.option.unlocked_folder.encrypted.on"
                    : "modal.settings.option.unlocked_folder.encrypted.off",
                ),
              })}
              description={t(`modal.settings.option.unlocked_folder.encrypted.${value}_desc`)}
              onSelect={() => undefined}
            />
          ))}
        </RadioGroup>
      </View>
      <View style={styles.fieldGroup}>
        <FieldLabel>{t("modal.settings.field.unlocked_folder.list")}</FieldLabel>
        <FieldHint>
          {t(
            plaintext
              ? "modal.settings.field.unlocked_folder.list_help_plain"
              : "modal.settings.field.unlocked_folder.list_help",
          )}
        </FieldHint>
        <FolderList
          label={t("modal.settings.field.unlocked_folder.list")}
          policy={VAULT_UNLOCKED_LIST}
          groups={config.devices}
          saved={saved}
          here={here}
          lockedHint={lockedHint}
          fixed={[
            {
              choice: "inherit",
              title: t("folder_list.choice.inherit"),
              description: t("folder_list.choice.inherit_now", { choice: appChoice }),
              folder: shownFolder(appFolder),
            },
          ]}
          renderStatus={renderStatus}
          markUnsaved={vaultId !== null}
          rowInUse={rowInUse}
          pickFolder={pickFolder}
          onChange={(devices) => onChange({ devices })}
        />
      </View>
    </View>
  );
}

/** The vault's backup folders on this phone, under the backup switches. */
export function VaultBackupFolderField({
  devices,
  saved,
  here,
  vaultId,
  appBackups,
  onChange,
}: {
  devices: DeviceGroups<VaultBackupChoice>;
  saved: DeviceGroups<VaultBackupChoice>;
  here: HereDevice | null;
  vaultId: string | null;
  appBackups: AppBackupFolders;
  onChange: (devices: DeviceGroups<VaultBackupChoice>) => void;
}) {
  const { t } = useTranslation();
  const { renderStatus } = useRowStatuses("backup", devices, here, vaultId);
  const pickFolder = usePickFolder();
  const hereId = here?.id ?? null;
  const appSelection = selectionHere(appBackups.devices, hereId, APP_BACKUP_LIST);
  const appGroup = hereId ? appBackups.devices[hereId] : undefined;
  const appChoice = selectionLabel(appSelection, appGroup, t);
  const folders = useFixedFolders(here, vaultId);
  const appFolder = selectionFolder(appSelection, appGroup, () => folders.dataFolderBackups);
  return (
    <View style={styles.fields}>
      <FieldLabel>{t("modal.settings.field.backup.folder")}</FieldLabel>
      <FieldHint>{t("modal.settings.field.backup.folder_help")}</FieldHint>
      <FolderList
        label={t("modal.settings.field.backup.folder")}
        policy={VAULT_BACKUP_LIST}
        groups={devices}
        saved={saved}
        here={here}
        fixed={[
          {
            choice: "inherit",
            title: t("folder_list.choice.inherit"),
            description: t("folder_list.choice.inherit_now", { choice: appChoice }),
            folder: shownFolder(appFolder),
          },
          {
            choice: "data_folder",
            title: t("folder_list.choice.data_folder"),
            description: t("modal.settings.field.backup.folder_data_desc"),
            folder: shownFolder(folders.dataFolderBackups),
          },
        ]}
        renderStatus={renderStatus}
        markUnsaved={vaultId !== null}
        pickFolder={pickFolder}
        onChange={onChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.md },
  fieldGroup: { gap: spacing.xs },
});
