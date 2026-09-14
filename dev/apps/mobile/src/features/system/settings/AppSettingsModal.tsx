import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import {
  APP_SETTINGS_ERROR_I18N_KEYS,
  APP_SETTINGS_SECTIONS,
  LOADING_BUDGET_MS,
  LOG_ENTRIES_PER_FILE,
  LOG_KEEP_LAST_ENTRY_OPTIONS,
  LOG_KEEP_LAST_UNLIMITED,
  LOG_LEVEL_PRESETS,
  SUPPORTED_LOCALES,
  appSettingsEqual,
  isRpcError,
  shouldBumpVaultRootEpoch,
  logFileCountForKeepLast,
  normalizeAppSettings,
  validateWorkspaceGlobalPath,
  vaultRootGoneRpcError,
  vaultRootPathForWorkspaceValidation,
  workspacePathIssueI18nKey,
  type AppSettingsConfig,
  type LocaleId,
  type UiTheme,
} from "@upriv/shared";
import { useAppSettingsContext } from "./AppSettingsContext";
import { useTranslation, type I18nKey } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import {
  Button,
  LoadingBudgetHint,
  Modal,
  ModalFooterActions,
  modalFooterConfirmBtnStyle,
  Select,
  Toast,
  type SelectOption,
} from "@/components/ui";
import { useTapNotPan } from "@/components/ui/ScrimDismiss";
import {
  FieldHint,
  FieldLabel,
  PolicyRadioOption,
  SettingsAccordionSection,
  SwitchRow,
  ThemedInput,
} from "@/components/settings";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { useLoadingBudget, useToast, useVaultRootIntegrityClose } from "@upriv/shared/react";
import { useVaultRootService } from "@/platform/services";

const SAVED_INDICATOR_MS = 1500;
const THEMES: UiTheme[] = ["dark", "neutral", "light"];

interface AppSettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** Report unsaved draft so the list shell can refuse opening Data folder / Groups. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Disable Clear on workspace path while any vault session is open. */
  hasOpenVault?: boolean;
}

/**
 * System settings — draft + Save parity with desktop `AppSettingsModal`.
 * Creating groups lives in `VaultGroupsModal` (⋯ menu). Data folder stays in its own modal.
 */
export function AppSettingsModal({
  open,
  onClose,
  onDirtyChange,
  hasOpenVault = false,
}: AppSettingsModalProps) {
  const { t, locale } = useTranslation();
  const { colors, typography } = useTheme();
  const { message, show, dismiss } = useToast();
  const vaultRootService = useVaultRootService();
  const {
    settings,
    replaceSettings,
    showHiddenVaultsSession,
    setShowHiddenVaultsSession,
    settingsOnDisk,
    reportVaultRootIntegrityFailure,
  } = useAppSettingsContext();

  const [draft, setDraft] = useState<AppSettingsConfig | null>(null);
  const [draftShowHiddenVaultsSession, setDraftShowHiddenVaultsSession] = useState(false);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [savedVisible, setSavedVisible] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [resolvedRootPath, setResolvedRootPath] = useState<string | null>(null);
  const [resolveFailure, setResolveFailure] = useState<unknown>(null);
  const savedHideRef = useRef<ReturnType<typeof setTimeout>>();
  const openedSessionRef = useRef(false);
  /** True after the user patches workspace this modal session — skip live Context sync. */
  const workspaceTouchedRef = useRef(false);
  const commitSaveLock = useRef(false);
  const saveBusyGen = useRef(0);
  const saveBudget = useLoadingBudget(saveBusy, LOADING_BUDGET_MS.settingsSave);

  const isDirty = useMemo(
    () =>
      Boolean(draft && !appSettingsEqual(draft, settings)) ||
      draftShowHiddenVaultsSession !== showHiddenVaultsSession,
    [draft, draftShowHiddenVaultsSession, settings, showHiddenVaultsSession],
  );

  useEffect(() => {
    onDirtyChange?.(open && isDirty);
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange, open]);

  useEffect(() => {
    if (!open) return;
    if (openedSessionRef.current) return;
    openedSessionRef.current = true;
    workspaceTouchedRef.current = false;
    setDraft(settings);
    setDraftShowHiddenVaultsSession(showHiddenVaultsSession);
  }, [open, settings, showHiddenVaultsSession]);

  useEffect(() => {
    if (!open) return;
    setDraft((current) => {
      if (!current) return current;
      if (
        current.app.vault_root_mode === settings.app.vault_root_mode &&
        current.app.upriv_root_path === settings.app.upriv_root_path &&
        current.app.last_opened_vault === settings.app.last_opened_vault
      ) {
        return current;
      }
      return { ...current, app: { ...settings.app } };
    });
  }, [open, settings.app, settings.app.upriv_root_path, settings.app.vault_root_mode]);

  // Keep draft.workspace aligned unless the user edited Workspace this session.
  useEffect(() => {
    if (!open) return;
    if (workspaceTouchedRef.current) return;
    setDraft((current) => {
      if (!current) return current;
      if (current.workspace.path === settings.workspace.path) return current;
      return { ...current, workspace: { ...settings.workspace } };
    });
  }, [open, settings.workspace, settings.workspace.path]);

  useEffect(() => {
    if (!open) {
      setResolvedRootPath(null);
      setResolveFailure(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const resolved = await vaultRootService.resolve({
          vaultRootMode: settings.app.vault_root_mode,
        });
        if (cancelled) return;
        setResolveFailure(null);
        if (resolved.status === "found") {
          setResolvedRootPath(resolved.rootPath);
        } else {
          setResolvedRootPath(null);
          setResolveFailure(vaultRootGoneRpcError());
        }
      } catch (error) {
        if (!cancelled) {
          setResolvedRootPath(null);
          setResolveFailure(error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, settings.app.vault_root_mode, vaultRootService]);

  useEffect(() => {
    if (!open) {
      openedSessionRef.current = false;
      workspaceTouchedRef.current = false;
      saveBusyGen.current += 1;
      commitSaveLock.current = false;
      setDraft(null);
      setDraftShowHiddenVaultsSession(showHiddenVaultsSession);
      setSaveConfirmOpen(false);
      setDiscardConfirmOpen(false);
      setSavedVisible(false);
      setSaveBusy(false);
    }
  }, [open, showHiddenVaultsSession]);

  useEffect(() => {
    if (!isDirty) setSaveConfirmOpen(false);
  }, [isDirty]);

  useEffect(() => () => clearTimeout(savedHideRef.current), []);

  useEffect(() => {
    if (!saveBudget.timedOut || !saveBusy) return;
    saveBusyGen.current += 1;
    commitSaveLock.current = false;
    setSaveBusy(false);
    show(t("error.operation_timed_out"));
  }, [saveBudget.timedOut, saveBusy, show, t]);

  const dismissFooterConfirm = useCallback(() => {
    setDiscardConfirmOpen(false);
    setSaveConfirmOpen(false);
  }, []);
  const dismissConfirmOnBodyTap = useTapNotPan(
    dismissFooterConfirm,
    discardConfirmOpen || saveConfirmOpen,
  );

  const patchDraft = useCallback(
    <S extends keyof AppSettingsConfig>(section: S, patch: Partial<AppSettingsConfig[S]>) => {
      if (section === "workspace") {
        workspaceTouchedRef.current = true;
      }
      setDiscardConfirmOpen(false);
      setSaveConfirmOpen(false);
      setDraft((current) =>
        current
          ? {
              ...current,
              [section]: { ...current[section], ...patch },
            }
          : current,
      );
    },
    [],
  );

  const setDraftHiddenSession = useCallback((value: boolean) => {
    setDiscardConfirmOpen(false);
    setSaveConfirmOpen(false);
    setDraftShowHiddenVaultsSession(value);
  }, []);

  const handleClose = () => {
    setSaveConfirmOpen(false);
    setDiscardConfirmOpen(false);
    onClose();
  };

  useVaultRootIntegrityClose(open, resolveFailure, reportVaultRootIntegrityFailure, handleClose);

  const hadOnDiskRef = useRef(false);
  useEffect(() => {
    if (settingsOnDisk) hadOnDiskRef.current = true;
  }, [settingsOnDisk]);

  useEffect(() => {
    if (!open || settingsOnDisk || !hadOnDiskRef.current) return;
    saveBusyGen.current += 1;
    commitSaveLock.current = false;
    setDraft(null);
    setSaveBusy(false);
    setSaveConfirmOpen(false);
    setDiscardConfirmOpen(false);
    onClose();
  }, [open, settingsOnDisk, onClose]);

  const requestClose = () => {
    if (discardConfirmOpen || saveConfirmOpen) {
      dismissFooterConfirm();
      return;
    }
    if (isDirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    handleClose();
  };

  const handleDiscardAndClose = () => {
    setDraft(settings);
    setDraftShowHiddenVaultsSession(showHiddenVaultsSession);
    handleClose();
  };

  const formConfig = draft ?? settings;
  const workspaceRootForValidation = vaultRootPathForWorkspaceValidation(
    formConfig.app.vault_root_mode,
    formConfig.app.upriv_root_path,
    resolvedRootPath,
  );
  const workspacePathInvalid = Boolean(
    validateWorkspaceGlobalPath(formConfig.workspace.path, workspaceRootForValidation),
  );
  /** Open vault + emptied draft must not wipe a configured Context path. */
  const workspaceClearWhileOpen =
    hasOpenVault && !formConfig.workspace.path.trim() && Boolean(settings.workspace.path.trim());

  const handleSaveClick = () => {
    if (!isDirty || saveBusy) return;
    if (workspaceClearWhileOpen) return;
    const workspacePath = workspaceTouchedRef.current
      ? (draft ?? settings).workspace.path
      : settings.workspace.path;
    if (validateWorkspaceGlobalPath(workspacePath, workspaceRootForValidation)) {
      return;
    }
    dismissFooterConfirm();
    setSaveConfirmOpen(true);
  };

  const commitSave = () => {
    if (!isDirty || saveBusy) return;
    if (workspaceClearWhileOpen) return;
    const workspaceForSave = workspaceTouchedRef.current
      ? (draft ?? settings).workspace
      : { ...settings.workspace };
    if (validateWorkspaceGlobalPath(workspaceForSave.path, workspaceRootForValidation)) {
      return;
    }
    if (commitSaveLock.current) return;
    const generation = ++saveBusyGen.current;
    commitSaveLock.current = true;
    const normalized = normalizeAppSettings({
      ...(draft ?? settings),
      app: { ...settings.app },
      workspace: workspaceForSave,
    });
    setSaveBusy(true);
    void (async () => {
      try {
        if (!appSettingsEqual(normalized, settings)) {
          await replaceSettings(normalized);
          if (generation !== saveBusyGen.current) return;
          setDraft(normalized);
        }
        if (generation !== saveBusyGen.current) return;
        setShowHiddenVaultsSession(draftShowHiddenVaultsSession);
        setSavedVisible(true);
        clearTimeout(savedHideRef.current);
        savedHideRef.current = setTimeout(() => setSavedVisible(false), SAVED_INDICATOR_MS);
        setSaveConfirmOpen(false);
      } catch (error) {
        if (generation !== saveBusyGen.current) return;
        setSaveConfirmOpen(false);
        if (shouldBumpVaultRootEpoch(error)) {
          setDraft(settings);
          handleClose();
          return;
        }
        const fallback =
          isRpcError(error) && error.code === "invalid_request"
            ? APP_SETTINGS_ERROR_I18N_KEYS.INVALID_REQUEST
            : APP_SETTINGS_ERROR_I18N_KEYS.SAVE_FAILED;
        show(t(mobileErrorI18nKey(error, fallback)));
      } finally {
        if (generation === saveBusyGen.current) {
          commitSaveLock.current = false;
          setSaveBusy(false);
        }
      }
    })();
  };

  const saveBlocked =
    !isDirty || saveBusy || saveConfirmOpen || workspacePathInvalid || workspaceClearWhileOpen;

  if (!open || !formConfig) return null;

  const footerStatus = discardConfirmOpen ? (
    <Text style={typography.bodyMuted}>{t("modal.settings.discard_confirm")}</Text>
  ) : saveConfirmOpen ? (
    <Text style={typography.bodyMuted}>{t("modal.app_settings.save_confirm")}</Text>
  ) : savedVisible ? (
    <Text style={[typography.body, { color: colors.vaultStatusOpen }]}>
      {t("modal.settings.saved")}
    </Text>
  ) : null;
  const showFooterStatus = Boolean(footerStatus) || saveBudget.visible;

  const footer = (
    <View style={showFooterStatus ? styles.footerCol : undefined}>
      {showFooterStatus ? (
        <View>
          {footerStatus}
          {saveBudget.visible ? (
            <LoadingBudgetHint
              budgetMs={saveBudget.budgetMs}
              remainingMs={saveBudget.remainingMs}
            />
          ) : null}
        </View>
      ) : null}
      {discardConfirmOpen ? (
        <ModalFooterActions layout="confirm">
          <Button
            variant="danger"
            label={t("modal.settings.discard_confirm_action")}
            style={modalFooterConfirmBtnStyle}
            onPress={handleDiscardAndClose}
          />
          <Button
            variant="ghost"
            label={t("modal.settings.discard_keep_editing")}
            style={modalFooterConfirmBtnStyle}
            onPress={dismissFooterConfirm}
          />
        </ModalFooterActions>
      ) : (
        <ModalFooterActions layout="confirm">
          <Button
            variant="primary"
            label={
              saveConfirmOpen ? t("modal.settings.save_confirm_action") : t("modal.settings.save")
            }
            style={modalFooterConfirmBtnStyle}
            disabled={saveConfirmOpen ? saveBusy : saveBlocked}
            onPress={saveConfirmOpen ? commitSave : handleSaveClick}
          />
          {saveConfirmOpen ? (
            <Button
              variant="ghost"
              label={t("modal.settings.save_cancel")}
              style={modalFooterConfirmBtnStyle}
              disabled={saveBusy}
              onPress={dismissFooterConfirm}
            />
          ) : null}
        </ModalFooterActions>
      )}
    </View>
  );

  return (
    <>
      <Modal
        open={open}
        title={t("modal.app_settings.title")}
        titleIcon="settings"
        onClose={requestClose}
        panelClassName="max-w-3xl"
        footer={footer}
      >
        <View style={styles.content} {...dismissConfirmOnBodyTap}>
          {APP_SETTINGS_SECTIONS.map((sectionId) => (
            <SettingsAccordionSection
              key={sectionId}
              title={t(`modal.app_settings.section.${sectionId}`)}
              defaultOpen={sectionId === "language"}
            >
              {sectionId === "language" ? (
                <LanguageFields
                  config={formConfig.ui}
                  onChange={(patch) => patchDraft("ui", patch)}
                />
              ) : null}
              {sectionId === "general" ? (
                <GeneralFields
                  config={formConfig.ui}
                  onChange={(patch) => patchDraft("ui", patch)}
                />
              ) : null}
              {sectionId === "workspace" ? (
                <WorkspaceFields
                  config={formConfig.workspace}
                  vaultRootPath={workspaceRootForValidation}
                  clearDisabled={hasOpenVault}
                  onChange={(patch) => patchDraft("workspace", patch)}
                />
              ) : null}
              {sectionId === "vault_list" ? (
                <VaultListFields
                  config={formConfig.ui}
                  onChange={(patch) => patchDraft("ui", patch)}
                />
              ) : null}
              {sectionId === "groups" ? (
                <GroupsPrefsFields
                  config={formConfig.ui}
                  onChange={(patch) => patchDraft("ui", patch)}
                />
              ) : null}
              {sectionId === "logging" ? (
                <LoggingFields
                  config={formConfig.logging}
                  locale={locale}
                  onChange={(patch) => patchDraft("logging", patch)}
                />
              ) : null}
              {sectionId === "hidden_vaults" ? (
                <HiddenVaultsFields
                  alwaysShowHiddenVaults={formConfig.ui.always_show_hidden_vaults}
                  onAlwaysShowHiddenVaultsChange={(always_show_hidden_vaults) =>
                    patchDraft("ui", { always_show_hidden_vaults })
                  }
                  showHiddenVaultsSession={draftShowHiddenVaultsSession}
                  onShowHiddenVaultsSessionChange={setDraftHiddenSession}
                />
              ) : null}
            </SettingsAccordionSection>
          ))}
        </View>
      </Modal>
      <Toast message={message} onDismiss={dismiss} />
    </>
  );
}

function LanguageFields({
  config,
  onChange,
}: {
  config: AppSettingsConfig["ui"];
  onChange: (patch: Partial<AppSettingsConfig["ui"]>) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.fields}>
      <FieldHint>{t("modal.app_settings.section.language_intro")}</FieldHint>

      <View
        style={styles.optionsCol}
        accessibilityRole="radiogroup"
        accessibilityLabel={t("modal.app_settings.section.language")}
      >
        {SUPPORTED_LOCALES.map((loc) => (
          <PolicyRadioOption
            key={loc}
            value={loc}
            checked={config.locale === loc}
            title={t(`modal.app_settings.option.locale.${loc}`)}
            description={t(`modal.app_settings.option.locale.${loc}_desc` as I18nKey)}
            badge={loc === "en" ? "default" : undefined}
            onSelect={() => onChange({ locale: loc as LocaleId })}
          />
        ))}
      </View>
    </View>
  );
}

function GeneralFields({
  config,
  onChange,
}: {
  config: AppSettingsConfig["ui"];
  onChange: (patch: Partial<AppSettingsConfig["ui"]>) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.fields}>
      <FieldHint>{t("modal.app_settings.section.general_intro")}</FieldHint>

      <FieldGroup
        label={t("modal.app_settings.field.theme")}
        hint={t("modal.app_settings.field.theme_help")}
      >
        <View
          style={styles.optionsCol}
          accessibilityRole="radiogroup"
          accessibilityLabel={t("modal.app_settings.field.theme")}
        >
          {THEMES.map((theme) => (
            <PolicyRadioOption
              key={theme}
              value={theme}
              checked={config.theme === theme}
              title={t(`modal.app_settings.option.theme.${theme}`)}
              description={t(`modal.app_settings.option.theme.${theme}_desc` as I18nKey)}
              badge={theme === "dark" ? "default" : undefined}
              onSelect={() => onChange({ theme })}
            />
          ))}
        </View>
      </FieldGroup>

      <SwitchRow
        label={t("modal.app_settings.field.vault_list_show_header_more_button")}
        value={config.vault_list_show_header_more_button}
        onValueChange={(vault_list_show_header_more_button) =>
          onChange({ vault_list_show_header_more_button })
        }
      />
      <SwitchRow
        label={t("modal.app_settings.field.lifecycle_close_modal_on_submit")}
        hint={t("modal.app_settings.field.lifecycle_close_modal_on_submit_help")}
        value={config.lifecycle_close_modal_on_submit}
        onValueChange={(lifecycle_close_modal_on_submit) =>
          onChange({ lifecycle_close_modal_on_submit })
        }
      />
    </View>
  );
}

function WorkspaceFields({
  config,
  onChange,
  vaultRootPath,
  clearDisabled = false,
}: {
  config: AppSettingsConfig["workspace"];
  onChange: (patch: Partial<AppSettingsConfig["workspace"]>) => void;
  vaultRootPath: string | null;
  clearDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const vaultRootService = useVaultRootService();
  const pathIssue = validateWorkspaceGlobalPath(config.path, vaultRootPath);
  const canClear = Boolean(config.path.trim()) && !clearDisabled;

  return (
    <View style={styles.fields}>
      <FieldHint>{t("modal.app_settings.section.workspace_intro")}</FieldHint>
      <FieldLabel>{t("modal.app_settings.field.workspace.path")}</FieldLabel>
      <FieldHint>{t("modal.app_settings.field.workspace.path_help")}</FieldHint>
      <ThemedInput
        value={config.path}
        placeholder={t("modal.app_settings.field.workspace.path_placeholder")}
        onChangeText={(path) => {
          if (clearDisabled) return;
          onChange({ path });
        }}
        editable={!clearDisabled}
        mono
      />
      <View style={styles.rowWrap}>
        <Button
          size="sm"
          variant="ghost"
          label={t("modal.app_settings.action.pick_workspace_folder")}
          disabled={clearDisabled || Platform.OS !== "android"}
          onPress={() => {
            if (clearDisabled) return;
            void (async () => {
              const picked = await vaultRootService.pickFolder(
                config.path.trim() || null,
                t("modal.app_settings.action.pick_workspace_folder"),
              );
              if (!picked?.trim()) return;
              onChange({ path: picked.trim() });
            })();
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          label={t("modal.app_settings.action.clear_workspace_path")}
          disabled={!canClear}
          onPress={() => {
            if (clearDisabled) return;
            onChange({ path: "" });
          }}
        />
      </View>
      {Platform.OS !== "android" ? <FieldHint>{t("error.unsupported_platform")}</FieldHint> : null}
      {clearDisabled ? (
        <FieldHint>{t("modal.app_settings.action.clear_workspace_path_blocked_open")}</FieldHint>
      ) : null}
      {pathIssue ? (
        <Text
          style={[typography.caption, { color: colors.onErrorContainer }]}
          accessibilityRole="alert"
        >
          {t(workspacePathIssueI18nKey(pathIssue))}
        </Text>
      ) : null}
    </View>
  );
}

function VaultListFields({
  config,
  onChange,
}: {
  config: AppSettingsConfig["ui"];
  onChange: (patch: Partial<AppSettingsConfig["ui"]>) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.fields}>
      <FieldHint>{t("modal.app_settings.section.vault_list_intro")}</FieldHint>

      <SwitchRow
        label={t("modal.app_settings.field.vault_list_show_drag")}
        hint={t("modal.app_settings.field.vault_list_show_drag_help")}
        value={config.vault_list_show_drag}
        onValueChange={(vault_list_show_drag) => onChange({ vault_list_show_drag })}
      />
      <SwitchRow
        label={t("modal.app_settings.field.vault_list_show_create_button")}
        value={config.vault_list_show_create_button}
        onValueChange={(vault_list_show_create_button) =>
          onChange({ vault_list_show_create_button })
        }
      />
      <SwitchRow
        label={t("modal.app_settings.field.vault_list_show_search_button")}
        value={config.vault_list_show_search_button}
        onValueChange={(vault_list_show_search_button) =>
          onChange({ vault_list_show_search_button })
        }
      />
      <SwitchRow
        label={t("modal.app_settings.field.vault_list_show_sort_button")}
        value={config.vault_list_show_sort_button}
        onValueChange={(vault_list_show_sort_button) => onChange({ vault_list_show_sort_button })}
      />
      <SwitchRow
        label={t("modal.app_settings.field.vault_list_show_view_button")}
        value={config.vault_list_show_view_button}
        onValueChange={(vault_list_show_view_button) => onChange({ vault_list_show_view_button })}
      />
      <SwitchRow
        label={t("modal.app_settings.field.vault_list_show_vault_more_button")}
        value={config.vault_list_show_vault_more_button}
        onValueChange={(vault_list_show_vault_more_button) =>
          onChange({ vault_list_show_vault_more_button })
        }
      />
      <SwitchRow
        label={t("modal.app_settings.field.vault_list_show_vault_settings_button")}
        value={config.vault_list_show_vault_settings_button}
        onValueChange={(vault_list_show_vault_settings_button) =>
          onChange({ vault_list_show_vault_settings_button })
        }
      />
    </View>
  );
}

function GroupsPrefsFields({
  config,
  onChange,
}: {
  config: AppSettingsConfig["ui"];
  onChange: (patch: Partial<AppSettingsConfig["ui"]>) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.fields}>
      <FieldHint>{t("modal.app_settings.section.groups_settings_intro")}</FieldHint>

      <SwitchRow
        label={t("modal.app_settings.field.vault_list_show_group_settings_button")}
        value={config.vault_list_show_group_settings_button}
        onValueChange={(vault_list_show_group_settings_button) =>
          onChange({ vault_list_show_group_settings_button })
        }
      />
      <SwitchRow
        label={t("modal.app_settings.field.vault_list_allow_drag_into_group")}
        hint={t("modal.app_settings.field.vault_list_allow_drag_into_group_help")}
        value={config.vault_list_allow_drag_into_group}
        onValueChange={(vault_list_allow_drag_into_group) =>
          onChange({ vault_list_allow_drag_into_group })
        }
      />
    </View>
  );
}

function LoggingFields({
  config,
  locale,
  onChange,
}: {
  config: AppSettingsConfig["logging"];
  locale: string;
  onChange: (patch: Partial<AppSettingsConfig["logging"]>) => void;
}) {
  const { t } = useTranslation();

  const keepLastOptions = useMemo<SelectOption<string>[]>(() => {
    const options: SelectOption<string>[] = LOG_KEEP_LAST_ENTRY_OPTIONS.map((entries) => ({
      value: String(entries),
      label: formatKeepLast(t, locale, entries),
    }));
    options.push({
      value: String(LOG_KEEP_LAST_UNLIMITED),
      label: formatKeepLast(t, locale, LOG_KEEP_LAST_UNLIMITED),
    });
    return options;
  }, [locale, t]);

  const keepLastValue = String(
    config.keep_last_entries === LOG_KEEP_LAST_UNLIMITED
      ? LOG_KEEP_LAST_UNLIMITED
      : config.keep_last_entries,
  );

  return (
    <View style={styles.fields}>
      <FieldHint>{t("modal.app_settings.section.logging_intro")}</FieldHint>

      <SwitchRow
        label={t("modal.app_settings.field.logging_enabled_label")}
        hint={t("modal.app_settings.field.logging_enabled_help")}
        value={config.enabled}
        onValueChange={(enabled) => onChange({ enabled })}
      />

      <FieldGroup
        label={t("modal.app_settings.field.logging_level")}
        hint={t("modal.app_settings.field.logging_level_help")}
        disabled={!config.enabled}
      >
        <View
          style={styles.optionsCol}
          accessibilityRole="radiogroup"
          accessibilityLabel={t("modal.app_settings.field.logging_level")}
        >
          {LOG_LEVEL_PRESETS.map((level) => (
            <PolicyRadioOption
              key={level}
              value={level}
              checked={config.level === level}
              disabled={!config.enabled}
              title={t(`modal.app_settings.option.logging_level.${level}`)}
              description={t(`modal.app_settings.option.logging_level.${level}_desc` as I18nKey)}
              badge={level === "info" ? "recommended" : undefined}
              onSelect={() => onChange({ level })}
            />
          ))}
        </View>
      </FieldGroup>

      <FieldGroup
        label={t("modal.app_settings.field.logging_keep_last")}
        hint={t("modal.app_settings.field.logging_keep_last_help", {
          perFile: String(LOG_ENTRIES_PER_FILE),
        })}
        disabled={!config.enabled}
      >
        <Select<string>
          value={keepLastValue}
          options={keepLastOptions}
          disabled={!config.enabled}
          title={t("modal.app_settings.field.logging_keep_last")}
          accessibilityLabel={t("modal.app_settings.field.logging_keep_last")}
          onChange={(next) => {
            const parsed = Number.parseInt(next, 10);
            onChange({
              keep_last_entries: Number.isNaN(parsed) ? LOG_KEEP_LAST_UNLIMITED : parsed,
              entries_per_file: LOG_ENTRIES_PER_FILE,
            });
          }}
        />
      </FieldGroup>
    </View>
  );
}

function FieldGroup({
  label,
  hint,
  disabled = false,
  children,
}: {
  label: string;
  hint?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.fieldGroup}>
      <FieldLabel disabled={disabled}>{label}</FieldLabel>
      {hint ? <FieldHint disabled={disabled}>{hint}</FieldHint> : null}
      {children}
    </View>
  );
}

function HiddenVaultsFields({
  alwaysShowHiddenVaults,
  onAlwaysShowHiddenVaultsChange,
  showHiddenVaultsSession,
  onShowHiddenVaultsSessionChange,
}: {
  alwaysShowHiddenVaults: boolean;
  onAlwaysShowHiddenVaultsChange: (value: boolean) => void;
  showHiddenVaultsSession: boolean;
  onShowHiddenVaultsSessionChange: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.fields}>
      <FieldHint>{t("modal.app_settings.section.hidden_vaults_intro")}</FieldHint>
      <SwitchRow
        label={t("modal.app_settings.field.show_hidden_vaults_session")}
        hint={t("modal.app_settings.field.show_hidden_vaults_session_help")}
        value={showHiddenVaultsSession}
        onValueChange={onShowHiddenVaultsSessionChange}
      />
      <SwitchRow
        label={t("modal.app_settings.field.always_show_hidden_vaults")}
        hint={t("modal.app_settings.field.always_show_hidden_vaults_help")}
        value={alwaysShowHiddenVaults}
        onValueChange={onAlwaysShowHiddenVaultsChange}
      />
    </View>
  );
}

function formatKeepLast(
  t: ReturnType<typeof useTranslation>["t"],
  locale: string,
  entries: number,
): string {
  if (entries === LOG_KEEP_LAST_UNLIMITED) {
    return t("modal.app_settings.option.logging_keep_last.unlimited");
  }
  const files = logFileCountForKeepLast(entries);
  return t("modal.app_settings.option.logging_keep_last.entries", {
    entries: entries.toLocaleString(locale),
    files: String(files),
  });
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingBottom: spacing.sm },
  fields: { gap: spacing.md },
  fieldGroup: { gap: spacing.xs },
  optionsCol: { gap: spacing.sm },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  footerCol: { gap: spacing.md },
});
