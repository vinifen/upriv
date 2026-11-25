import { useId } from "react";
import { Select, SwitchRow } from "@/components/ui";
import { FolderList } from "@/components/folder-list";
import {
  DisplayNameFieldError,
  PolicyRadioOption,
  settingsControlClass,
  SettingsField,
  SettingsFormGrid,
  UnlockedFolderDriverNotice,
  useFixedFolders,
  usePickFolder,
  useRowStatuses,
  useUnlockedFolderDriver,
} from "@/components/settings";
import { useTranslation } from "@/i18n";
import {
  APP_BACKUP_LIST,
  APP_UNLOCKED_LIST,
  LOG_ENTRIES_PER_FILE,
  LOG_KEEP_LAST_DEFAULT,
  LOG_KEEP_LAST_ENTRY_OPTIONS,
  LOG_KEEP_LAST_UNLIMITED,
  LOG_LEVEL_PRESETS,
  SUPPORTED_LOCALES,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  appUnlockedFixedFolders,
  besideFolder,
  encryptedFolderUnchosen,
  liveDisplayNameError,
  isPhoneSystem,
  logFileCountForKeepLast,
  type AppSettingsConfig,
  type HereDevice,
  type UiTheme,
  type VaultGroup,
  type VaultListItem,
} from "@upriv/shared";
import { GroupedVaultPicker } from "@/features/vaults/list/modals/GroupedVaultPicker";

interface SectionPatchProps<S extends keyof AppSettingsConfig> {
  config: AppSettingsConfig[S];
  onChange: (patch: Partial<AppSettingsConfig[S]>) => void;
}

const THEMES: UiTheme[] = ["dark", "neutral", "light"];

export function AppSettingsLanguageSection({ config, onChange }: SectionPatchProps<"ui">) {
  const { t } = useTranslation();
  const localeGroup = useId();

  return (
    <SettingsFormGrid>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("modal.app_settings.section.language_intro")}
      </p>

      <div
        role="radiogroup"
        aria-label={t("modal.app_settings.section.language")}
        className="grid gap-2"
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <PolicyRadioOption
            key={locale}
            groupName={localeGroup}
            value={locale}
            checked={config.locale === locale}
            title={t(`modal.app_settings.option.locale.${locale}`)}
            description={t(`modal.app_settings.option.locale.${locale}_desc`)}
            badge={locale === "en" ? "default" : undefined}
            onSelect={() => onChange({ locale })}
          />
        ))}
      </div>
    </SettingsFormGrid>
  );
}

export function AppSettingsGeneralSection({ config, onChange }: SectionPatchProps<"ui">) {
  const { t } = useTranslation();
  const themeGroup = useId();
  const showHeaderMoreId = useId();
  const closeModalOnSubmitId = useId();
  const openFileManagerOnOpenId = useId();
  const keepOpenOnWakeId = useId();
  const confirmCloseNowId = useId();
  const confirmStopId = useId();
  const confirmLockId = useId();

  return (
    <SettingsFormGrid>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("modal.app_settings.section.general_intro")}
      </p>

      <SettingsField
        label={t("modal.app_settings.field.theme")}
        hint={t("modal.app_settings.field.theme_help")}
      >
        <div
          role="radiogroup"
          aria-label={t("modal.app_settings.field.theme")}
          className="grid gap-2"
        >
          {THEMES.map((theme) => (
            <PolicyRadioOption
              key={theme}
              groupName={themeGroup}
              value={theme}
              checked={config.theme === theme}
              title={t(`modal.app_settings.option.theme.${theme}`)}
              description={t(`modal.app_settings.option.theme.${theme}_desc`)}
              badge={theme === "dark" ? "default" : undefined}
              onSelect={() => onChange({ theme })}
            />
          ))}
        </div>
      </SettingsField>

      <SwitchRow
        id={showHeaderMoreId}
        checked={config.vault_list_show_header_more_button}
        onChange={(vault_list_show_header_more_button) =>
          onChange({ vault_list_show_header_more_button })
        }
        label={t("modal.app_settings.field.vault_list_show_header_more_button")}
      />
      <SwitchRow
        id={closeModalOnSubmitId}
        checked={config.lifecycle_close_modal_on_submit}
        onChange={(lifecycle_close_modal_on_submit) =>
          onChange({ lifecycle_close_modal_on_submit })
        }
        label={t("modal.app_settings.field.lifecycle_close_modal_on_submit")}
        hint={t("modal.app_settings.field.lifecycle_close_modal_on_submit_help")}
      />
      <SwitchRow
        id={openFileManagerOnOpenId}
        checked={config.lifecycle_open_file_manager_on_open}
        onChange={(lifecycle_open_file_manager_on_open) =>
          onChange({ lifecycle_open_file_manager_on_open })
        }
        label={t("modal.app_settings.field.lifecycle_open_file_manager_on_open")}
        hint={t("modal.app_settings.field.lifecycle_open_file_manager_on_open_help")}
      />
      <SwitchRow
        id={keepOpenOnWakeId}
        checked={config.lifecycle_keep_open_on_wake}
        onChange={(lifecycle_keep_open_on_wake) => onChange({ lifecycle_keep_open_on_wake })}
        label={t("modal.app_settings.field.lifecycle_keep_open_on_wake")}
        hint={t("modal.app_settings.field.lifecycle_keep_open_on_wake_help")}
      />
      <SwitchRow
        id={confirmCloseNowId}
        checked={config.lifecycle_confirm_close_now}
        onChange={(lifecycle_confirm_close_now) => onChange({ lifecycle_confirm_close_now })}
        label={t("modal.app_settings.field.lifecycle_confirm_close_now")}
        hint={t("modal.app_settings.field.lifecycle_confirm_close_now_help")}
      />
      <SwitchRow
        id={confirmStopId}
        checked={config.lifecycle_confirm_stop}
        onChange={(lifecycle_confirm_stop) => onChange({ lifecycle_confirm_stop })}
        label={t("modal.app_settings.field.lifecycle_confirm_stop")}
        hint={t("modal.app_settings.field.lifecycle_confirm_stop_help")}
      />
      <SwitchRow
        id={confirmLockId}
        checked={config.lifecycle_confirm_lock}
        onChange={(lifecycle_confirm_lock) => onChange({ lifecycle_confirm_lock })}
        label={t("modal.app_settings.field.lifecycle_confirm_lock")}
        hint={t("modal.app_settings.field.lifecycle_confirm_lock_help")}
      />
    </SettingsFormGrid>
  );
}

export function AppSettingsVaultListSection({ config, onChange }: SectionPatchProps<"ui">) {
  const { t } = useTranslation();
  const vaultListShowDragId = useId();
  const showCreateId = useId();
  const showSearchId = useId();
  const showSortId = useId();
  const showViewId = useId();
  const showVaultMoreId = useId();
  const showVaultSettingsId = useId();

  return (
    <SettingsFormGrid>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("modal.app_settings.section.vault_list_intro")}
      </p>

      <SwitchRow
        id={vaultListShowDragId}
        checked={config.vault_list_show_drag}
        onChange={(vault_list_show_drag) => onChange({ vault_list_show_drag })}
        label={t("modal.app_settings.field.vault_list_show_drag")}
        hint={t("modal.app_settings.field.vault_list_show_drag_help")}
      />
      <SwitchRow
        id={showCreateId}
        checked={config.vault_list_show_create_button}
        onChange={(vault_list_show_create_button) => onChange({ vault_list_show_create_button })}
        label={t("modal.app_settings.field.vault_list_show_create_button")}
      />
      <SwitchRow
        id={showSearchId}
        checked={config.vault_list_show_search_button}
        onChange={(vault_list_show_search_button) => onChange({ vault_list_show_search_button })}
        label={t("modal.app_settings.field.vault_list_show_search_button")}
      />
      <SwitchRow
        id={showSortId}
        checked={config.vault_list_show_sort_button}
        onChange={(vault_list_show_sort_button) => onChange({ vault_list_show_sort_button })}
        label={t("modal.app_settings.field.vault_list_show_sort_button")}
      />
      <SwitchRow
        id={showViewId}
        checked={config.vault_list_show_view_button}
        onChange={(vault_list_show_view_button) => onChange({ vault_list_show_view_button })}
        label={t("modal.app_settings.field.vault_list_show_view_button")}
      />
      <SwitchRow
        id={showVaultMoreId}
        checked={config.vault_list_show_vault_more_button}
        onChange={(vault_list_show_vault_more_button) =>
          onChange({ vault_list_show_vault_more_button })
        }
        label={t("modal.app_settings.field.vault_list_show_vault_more_button")}
      />
      <SwitchRow
        id={showVaultSettingsId}
        checked={config.vault_list_show_vault_settings_button}
        onChange={(vault_list_show_vault_settings_button) =>
          onChange({ vault_list_show_vault_settings_button })
        }
        label={t("modal.app_settings.field.vault_list_show_vault_settings_button")}
      />
    </SettingsFormGrid>
  );
}

/** List-drag prefs for groups — not the create-group form (`AppSettingsGroupsSection`). */
export function AppSettingsGroupsPrefsSection({ config, onChange }: SectionPatchProps<"ui">) {
  const { t } = useTranslation();
  const allowDragIntoGroupId = useId();
  const showGroupSettingsId = useId();

  return (
    <SettingsFormGrid>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("modal.app_settings.section.groups_settings_intro")}
      </p>

      <SwitchRow
        id={showGroupSettingsId}
        checked={config.vault_list_show_group_settings_button}
        onChange={(vault_list_show_group_settings_button) =>
          onChange({ vault_list_show_group_settings_button })
        }
        label={t("modal.app_settings.field.vault_list_show_group_settings_button")}
      />
      <SwitchRow
        id={allowDragIntoGroupId}
        checked={config.vault_list_allow_drag_into_group}
        onChange={(vault_list_allow_drag_into_group) =>
          onChange({ vault_list_allow_drag_into_group })
        }
        label={t("modal.app_settings.field.vault_list_allow_drag_into_group")}
        hint={t("modal.app_settings.field.vault_list_allow_drag_into_group_help")}
      />
    </SettingsFormGrid>
  );
}

interface AppSettingsGroupsSectionProps {
  vaults: VaultListItem[];
  groups: VaultGroup[];
  includeHidden?: boolean;
  newGroupName: string;
  groupedVaultIds: string[];
  hidden?: boolean;
  onHiddenChange?: (hidden: boolean) => void;
  onNewGroupNameChange: (name: string) => void;
  onToggleGroupedVault: (vaultId: string) => void;
}

export function AppSettingsGroupsSection({
  vaults,
  groups,
  includeHidden = false,
  newGroupName,
  groupedVaultIds,
  hidden = false,
  onHiddenChange,
  onNewGroupNameChange,
  onToggleGroupedVault,
}: AppSettingsGroupsSectionProps) {
  const { t } = useTranslation();
  const nameId = useId();

  return (
    <SettingsFormGrid>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("modal.app_settings.section.groups_intro")}
      </p>

      <SettingsField
        label={t("modal.app_settings.field.new_group_name")}
        htmlFor={nameId}
        hint={t("modal.app_settings.field.new_group_name_help")}
      >
        <input
          id={nameId}
          type="text"
          value={newGroupName}
          maxLength={VAULT_DISPLAY_NAME_MAX_LENGTH}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={liveDisplayNameError(newGroupName, { allowEmpty: true }) ? true : undefined}
          onChange={(event) => onNewGroupNameChange(event.target.value)}
          className={settingsControlClass}
          placeholder={t("vault.group.create.name_label")}
        />
        <DisplayNameFieldError name={newGroupName} allowEmpty />
      </SettingsField>

      <div className="space-y-2">
        <p className="font-mono text-xs uppercase tracking-wide text-on-surface-variant">
          {t("vault.group.create.grouped_vaults")}
        </p>
        <p className="text-xs leading-relaxed text-on-surface-variant">
          {t("vault.group.create.grouped_vaults_help")}
        </p>
        <GroupedVaultPicker
          vaults={vaults}
          groups={groups}
          includeHidden={includeHidden}
          selectedIds={groupedVaultIds}
          onToggle={onToggleGroupedVault}
        />
      </div>

      <SwitchRow
        checked={hidden}
        onChange={(next) => onHiddenChange?.(next)}
        label={t("vault.group.settings.hidden")}
        hint={t("vault.group.settings.hidden_help")}
      />
    </SettingsFormGrid>
  );
}

interface AppSettingsHiddenVaultsSectionProps {
  alwaysShowHiddenVaults: boolean;
  onAlwaysShowHiddenVaultsChange: (value: boolean) => void;
  showHiddenVaultsSession: boolean;
  onShowHiddenVaultsSessionChange: (value: boolean) => void;
}

export function AppSettingsHiddenVaultsSection({
  alwaysShowHiddenVaults,
  onAlwaysShowHiddenVaultsChange,
  showHiddenVaultsSession,
  onShowHiddenVaultsSessionChange,
}: AppSettingsHiddenVaultsSectionProps) {
  const { t } = useTranslation();
  const showHiddenSessionId = useId();
  const alwaysShowHiddenId = useId();

  return (
    <SettingsFormGrid>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("modal.app_settings.section.hidden_vaults_intro")}
      </p>

      <SwitchRow
        id={showHiddenSessionId}
        checked={showHiddenVaultsSession}
        onChange={onShowHiddenVaultsSessionChange}
        label={t("modal.app_settings.field.show_hidden_vaults_session")}
        hint={t("modal.app_settings.field.show_hidden_vaults_session_help")}
      />

      <SwitchRow
        id={alwaysShowHiddenId}
        checked={alwaysShowHiddenVaults}
        onChange={onAlwaysShowHiddenVaultsChange}
        label={t("modal.app_settings.field.always_show_hidden_vaults")}
        hint={t("modal.app_settings.field.always_show_hidden_vaults_help")}
      />
    </SettingsFormGrid>
  );
}

function formatLogKeepLastOption(
  t: ReturnType<typeof useTranslation>["t"],
  locale: string,
  entries: number,
): string {
  if (entries === LOG_KEEP_LAST_UNLIMITED) {
    return t("modal.app_settings.option.logging_keep_last.unlimited");
  }
  const files = logFileCountForKeepLast(entries);
  const label = t("modal.app_settings.option.logging_keep_last.entries", {
    entries: entries.toLocaleString(locale),
    files: String(files),
  });
  if (entries === LOG_KEEP_LAST_DEFAULT) {
    return `${label} — ${t("modal.settings.badge.default")}`;
  }
  return label;
}

export function AppSettingsLoggingSection({ config, onChange }: SectionPatchProps<"logging">) {
  const { locale, t } = useTranslation();
  const enabledId = useId();
  const levelGroup = useId();
  const keepLastId = useId();

  const keepLastValue =
    config.keep_last_entries === LOG_KEEP_LAST_UNLIMITED
      ? String(LOG_KEEP_LAST_UNLIMITED)
      : String(config.keep_last_entries);

  return (
    <SettingsFormGrid>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("modal.app_settings.section.logging_intro")}
      </p>

      <SwitchRow
        id={enabledId}
        checked={config.enabled}
        onChange={(enabled) => onChange({ enabled })}
        label={t("modal.app_settings.field.logging_enabled_label")}
        hint={t("modal.app_settings.field.logging_enabled_help")}
      />

      <SettingsField
        label={t("modal.app_settings.field.logging_level")}
        hint={t("modal.app_settings.field.logging_level_help")}
        disabled={!config.enabled}
      >
        <div
          role="radiogroup"
          aria-label={t("modal.app_settings.field.logging_level")}
          className="grid gap-2"
        >
          {LOG_LEVEL_PRESETS.map((level) => (
            <PolicyRadioOption
              key={level}
              groupName={levelGroup}
              value={level}
              checked={config.level === level}
              disabled={!config.enabled}
              title={t(`modal.app_settings.option.logging_level.${level}`)}
              description={t(`modal.app_settings.option.logging_level.${level}_desc`)}
              badge={level === "info" ? "recommended" : undefined}
              onSelect={() => onChange({ level })}
            />
          ))}
        </div>
      </SettingsField>

      <SettingsField
        label={t("modal.app_settings.field.logging_keep_last")}
        htmlFor={keepLastId}
        hint={t("modal.app_settings.field.logging_keep_last_help", {
          perFile: String(LOG_ENTRIES_PER_FILE),
        })}
        disabled={!config.enabled}
      >
        <Select
          id={keepLastId}
          value={keepLastValue}
          disabled={!config.enabled}
          aria-label={t("modal.app_settings.field.logging_keep_last")}
          onChange={(next) => {
            const parsed = Number.parseInt(next, 10);
            onChange({
              keep_last_entries: Number.isNaN(parsed) ? LOG_KEEP_LAST_UNLIMITED : parsed,
              entries_per_file: LOG_ENTRIES_PER_FILE,
            });
          }}
          options={[
            ...LOG_KEEP_LAST_ENTRY_OPTIONS.map((entries) => ({
              value: String(entries),
              label: formatLogKeepLastOption(t, locale, entries),
            })),
            {
              value: String(LOG_KEEP_LAST_UNLIMITED),
              label: formatLogKeepLastOption(t, locale, LOG_KEEP_LAST_UNLIMITED),
            },
          ]}
        />
      </SettingsField>
    </SettingsFormGrid>
  );
}

interface AppSettingsBackupsSectionProps extends SectionPatchProps<"backups"> {
  /** As loaded: a row loaded as it is keeps its path unchecked. */
  saved: AppSettingsConfig["backups"];
  here: HereDevice | null;
}

/** Where backups go on this device for every vault that follows the app's list. */
export function AppSettingsBackupsSection({
  config,
  onChange,
  saved,
  here,
}: AppSettingsBackupsSectionProps) {
  const { t } = useTranslation();
  const { renderStatus } = useRowStatuses("backup", config.devices, here, null);
  const pickFolder = usePickFolder();
  const folders = useFixedFolders(here, null);
  return (
    <SettingsFormGrid>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("modal.app_settings.section.backups_intro")}
      </p>
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
            folder: folders.dataFolderBackups,
          },
        ]}
        renderStatus={renderStatus}
        pickFolder={pickFolder}
        onChange={(devices) => onChange({ devices })}
      />
    </SettingsFormGrid>
  );
}

interface AppSettingsUnlockedFoldersSectionProps extends SectionPatchProps<"unlocked_folders"> {
  /** As loaded: a row loaded as it is keeps its path unchecked. */
  saved: AppSettingsConfig["unlocked_folders"];
  here: HereDevice | null;
  /** The data folder in use: Beside the data folder is in it. */
  vaultRootPath: string | null;
  /** Why this device's group cannot change now (a vault is open); `null` when it can. */
  lockedHint?: string | null;
}

/**
 * Where open vaults' files appear on this device for every vault that follows
 * the app's list, and whether encrypted vaults get a folder at all.
 */
export function AppSettingsUnlockedFoldersSection({
  config,
  onChange,
  saved,
  here,
  vaultRootPath,
  lockedHint = null,
}: AppSettingsUnlockedFoldersSectionProps) {
  const { t } = useTranslation();
  const driver = useUnlockedFolderDriver();
  const { renderStatus } = useRowStatuses("unlocked", config.devices, here, null);
  const pickFolder = usePickFolder();
  const phone = here ? isPhoneSystem(here.system) : false;
  const encryptedGroup = useId();
  const beside = vaultRootPath && here ? besideFolder(here.system, vaultRootPath) : null;
  return (
    <SettingsFormGrid>
      <SettingsField
        label={t("modal.app_settings.field.encrypted_vaults")}
        hint={t(
          phone
            ? "modal.settings.field.unlocked_folder.phone"
            : "modal.app_settings.field.encrypted_vaults_help",
        )}
        disabled={phone}
      >
        <div
          role="radiogroup"
          aria-label={t("modal.app_settings.field.encrypted_vaults")}
          className="grid gap-2"
        >
          {(["on", "off"] as const).map((value) => (
            <PolicyRadioOption
              key={value}
              groupName={encryptedGroup}
              value={value}
              checked={config.encrypted_vaults === (value === "on")}
              // On wants folders their driver cannot give yet.
              attention={value === "on" && driver.missing}
              disabled={phone || !driver.known || driver.busy}
              title={t(`modal.settings.option.unlocked_folder.encrypted.${value}`)}
              description={t(`modal.settings.option.unlocked_folder.encrypted.${value}_app_desc`)}
              onSelect={() => {
                const encrypted_vaults = value === "on";
                void (async () => {
                  if (encrypted_vaults && !(await driver.ensureInstalled())) return;
                  onChange({ encrypted_vaults });
                })();
              }}
            />
          ))}
        </div>
        <UnlockedFolderDriverNotice
          kind={driver.kind}
          missing={config.encrypted_vaults && driver.missing}
          busy={driver.busy}
          onInstall={driver.ensureInstalled}
        />
      </SettingsField>
      <SettingsField
        label={t("modal.app_settings.field.unlocked_folders.list")}
        hint={t("modal.app_settings.field.unlocked_folders.list_help")}
      >
        <FolderList
          label={t("modal.app_settings.field.unlocked_folders.list")}
          policy={APP_UNLOCKED_LIST}
          groups={config.devices}
          saved={saved.devices}
          here={here}
          lockedHint={lockedHint}
          selectionMissing={
            encryptedFolderUnchosen(config, null, here)
              ? t("modal.app_settings.field.unlocked_folders.unchosen")
              : null
          }
          fixed={[
            {
              choice: "beside",
              title: t("folder_list.choice.beside"),
              description: t("modal.app_settings.field.unlocked_folders.beside_desc"),
              folder: beside,
            },
          ]}
          fixedFolders={here ? appUnlockedFixedFolders(here.system, vaultRootPath) : []}
          renderStatus={renderStatus}
          pickFolder={pickFolder}
          onChange={(devices) => onChange({ devices })}
        />
      </SettingsField>
    </SettingsFormGrid>
  );
}
