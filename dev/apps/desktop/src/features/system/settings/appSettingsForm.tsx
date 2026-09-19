import { useId } from "react";
import { Button, Select, SwitchRow } from "@/components/ui";
import {
  DisplayNameFieldError,
  PolicyRadioOption,
  settingsControlClass,
  SettingsField,
  SettingsFormGrid,
} from "@/components/settings";
import { useTranslation } from "@/i18n";
import { useVaultRootService } from "@/platform/services";
import {
  LOG_ENTRIES_PER_FILE,
  LOG_KEEP_LAST_DEFAULT,
  LOG_KEEP_LAST_ENTRY_OPTIONS,
  LOG_KEEP_LAST_UNLIMITED,
  LOG_LEVEL_PRESETS,
  SUPPORTED_LOCALES,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  liveDisplayNameError,
  logFileCountForKeepLast,
  suggestedDefaultWorkspacePath,
  validateWorkspaceGlobalPath,
  workspacePathIssueI18nKey,
  type AppSettingsConfig,
  type UiTheme,
  type VaultGroup,
  type VaultListItem,
} from "@upriv/shared";
import { GroupedVaultPicker } from "@/features/vaults/list/modals/GroupedVaultPicker";
import { useErrorToast } from "@/hooks/useErrorToast";

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
  const confirmDeleteId = useId();

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
        id={confirmDeleteId}
        checked={config.file_manager_confirm_delete}
        onChange={(file_manager_confirm_delete) => onChange({ file_manager_confirm_delete })}
        label={t("modal.app_settings.field.file_manager_confirm_delete")}
        hint={t("modal.app_settings.field.file_manager_confirm_delete_help")}
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

      <SwitchRow
        checked={hidden}
        onChange={(next) => onHiddenChange?.(next)}
        label={t("vault.group.settings.hidden")}
        hint={t("vault.group.settings.hidden_help")}
      />

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

interface AppSettingsWorkspaceSectionProps extends SectionPatchProps<"workspace"> {
  /** Resolved vault-root path for reserved-path checks; null when unknown. */
  vaultRootPath?: string | null;
  /** When true, Clear is disabled (e.g. a vault session is open). */
  clearDisabled?: boolean;
}

export function AppSettingsWorkspaceSection({
  config,
  onChange,
  vaultRootPath = null,
  clearDisabled = false,
}: AppSettingsWorkspaceSectionProps) {
  const { t } = useTranslation();
  const { showError } = useErrorToast();
  const pathId = useId();
  const vaultRootService = useVaultRootService();
  const pathIssue = validateWorkspaceGlobalPath(config.path, vaultRootPath);
  const canClear = Boolean(config.path.trim()) && !clearDisabled;

  return (
    <SettingsFormGrid>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("modal.app_settings.section.workspace_intro")}
      </p>

      <SettingsField
        label={t("modal.app_settings.field.workspace.path")}
        hint={t("modal.app_settings.field.workspace.path_help")}
        htmlFor={pathId}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            id={pathId}
            type="text"
            value={config.path}
            readOnly={clearDisabled}
            placeholder={
              suggestedDefaultWorkspacePath(vaultRootPath) ||
              t("modal.app_settings.field.workspace.path_placeholder")
            }
            onChange={(e) => {
              if (clearDisabled) return;
              onChange({ path: e.target.value });
            }}
            className={[
              settingsControlClass,
              "font-mono text-xs sm:min-w-0 sm:flex-1",
              clearDisabled ? "cursor-default opacity-80" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0">
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="w-full sm:w-auto"
              disabled={clearDisabled}
              onClick={() => {
                if (clearDisabled) return;
                void (async () => {
                  try {
                    const picked = await vaultRootService.pickFolder(
                      config.path.trim() || null,
                      t("modal.app_settings.action.pick_workspace_folder"),
                    );
                    if (!picked?.trim()) return;
                    onChange({ path: picked.trim() });
                  } catch (error) {
                    showError(error, "error.unexpected");
                  }
                })();
              }}
            >
              {t("modal.app_settings.action.pick_workspace_folder")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="md"
              className="w-full sm:w-auto"
              disabled={!canClear}
              title={
                clearDisabled
                  ? t("modal.app_settings.action.clear_workspace_path_blocked_open")
                  : undefined
              }
              onClick={() => {
                if (clearDisabled) return;
                onChange({ path: "" });
              }}
            >
              {t("modal.app_settings.action.clear_workspace_path")}
            </Button>
          </div>
        </div>
        {clearDisabled ? (
          <p className="text-xs text-on-surface-variant">
            {t("modal.app_settings.action.clear_workspace_path_blocked_open")}
          </p>
        ) : null}
        {pathIssue ? (
          <p className="text-xs text-on-error-container" role="alert">
            {t(workspacePathIssueI18nKey(pathIssue))}
          </p>
        ) : null}
      </SettingsField>
    </SettingsFormGrid>
  );
}
