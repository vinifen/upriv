import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import {
  APP_SETTINGS_ERROR_I18N_KEYS,
  LOG_ENTRIES_PER_FILE,
  LOG_KEEP_LAST_ENTRY_OPTIONS,
  LOG_KEEP_LAST_UNLIMITED,
  LOG_LEVEL_PRESETS,
  SUPPORTED_LOCALES,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  appSettingsEqual,
  displayNameErrorI18nKey,
  isRpcError,
  isVaultRootErrorCode,
  logFileCountForKeepLast,
  normalizeAppSettings,
  validateDisplayName,
  type AppSettingsConfig,
  type LocaleId,
  type UiTheme,
  type VaultGroup,
  type VaultListItem,
} from "@upriv/shared";
import { useAppSettingsContext } from "./AppSettingsContext";
import { useTranslation, type I18nKey } from "@/i18n";
import { useTheme } from "@/theme";
import { radii, spacing } from "@/theme/tokens";
import { Button, Modal, Select, Toast, type SelectOption } from "@/components/ui";
import { Icon } from "@/components/icons";
import { PolicyRadioOption } from "@/components/settings";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { useToast } from "@/hooks/useToast";
import { GroupedVaultPicker } from "@/features/vaults/list/GroupedVaultPicker";

const SAVED_INDICATOR_MS = 1500;
const THEMES: UiTheme[] = ["dark", "neutral", "light"];
const MOBILE_SETTINGS_SECTIONS = ["appearance", "groups", "logging", "hidden_vaults"] as const;

interface AppSettingsModalProps {
  open: boolean;
  onClose: () => void;
  vaults?: VaultListItem[];
  groups?: VaultGroup[];
  includeHidden?: boolean;
  onCreateGroup?: (displayName: string, groupedVaultIds: string[]) => Promise<void> | void;
}

/**
 * System settings — draft + Save parity with desktop `AppSettingsModal`.
 * Data folder stays in its own modal; download_vaults is desktop-only for now.
 */
export function AppSettingsModal({
  open,
  onClose,
  vaults = [],
  groups = [],
  includeHidden = false,
  onCreateGroup,
}: AppSettingsModalProps) {
  const { t, locale } = useTranslation();
  const { colors, typography } = useTheme();
  const { message, show, dismiss } = useToast();
  const {
    settings,
    replaceSettings,
    showHiddenVaultsSession,
    setShowHiddenVaultsSession,
    settingsOnDisk,
  } = useAppSettingsContext();

  const [draft, setDraft] = useState<AppSettingsConfig | null>(null);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [savedVisible, setSavedVisible] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [expanded, setExpanded] = useState<string>("appearance");
  const [newGroupName, setNewGroupName] = useState("");
  const [groupedVaultIds, setGroupedVaultIds] = useState<string[]>([]);
  const [groupNameError, setGroupNameError] = useState<string | null>(null);
  const savedHideRef = useRef<ReturnType<typeof setTimeout>>();
  const openedSessionRef = useRef(false);
  const commitSaveLock = useRef(false);

  const pendingGroupName = newGroupName.trim();
  const isDirty = useMemo(() => {
    if (!draft) return pendingGroupName.length > 0;
    return !appSettingsEqual(draft, settings) || pendingGroupName.length > 0;
  }, [draft, pendingGroupName, settings]);

  useEffect(() => {
    if (!open) return;
    if (openedSessionRef.current) return;
    openedSessionRef.current = true;
    setDraft(settings);
    setExpanded("appearance");
    setNewGroupName("");
    setGroupedVaultIds([]);
    setGroupNameError(null);
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    setDraft((current) => {
      if (!current) return current;
      if (
        current.app.vault_root_mode === settings.app.vault_root_mode &&
        current.app.upriv_root_path === settings.app.upriv_root_path
      ) {
        return current;
      }
      return { ...current, app: { ...settings.app } };
    });
  }, [open, settings.app, settings.app.upriv_root_path, settings.app.vault_root_mode]);

  useEffect(() => {
    if (!open) {
      openedSessionRef.current = false;
      setDraft(null);
      setNewGroupName("");
      setGroupedVaultIds([]);
      setGroupNameError(null);
      setSaveConfirmOpen(false);
      setDiscardConfirmOpen(false);
      setSavedVisible(false);
    }
  }, [open]);

  useEffect(() => {
    if (!isDirty) setSaveConfirmOpen(false);
  }, [isDirty]);

  useEffect(() => () => clearTimeout(savedHideRef.current), []);

  const dismissFooterConfirm = useCallback(() => {
    setDiscardConfirmOpen(false);
    setSaveConfirmOpen(false);
  }, []);

  const patchDraft = useCallback(
    <S extends keyof AppSettingsConfig>(section: S, patch: Partial<AppSettingsConfig[S]>) => {
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

  const handleClose = () => {
    setSaveConfirmOpen(false);
    setDiscardConfirmOpen(false);
    onClose();
  };

  const hadOnDiskRef = useRef(false);
  useEffect(() => {
    if (settingsOnDisk) hadOnDiskRef.current = true;
  }, [settingsOnDisk]);

  useEffect(() => {
    if (!open || settingsOnDisk || !hadOnDiskRef.current) return;
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
    setNewGroupName("");
    setGroupedVaultIds([]);
    setGroupNameError(null);
    handleClose();
  };

  const handleSaveClick = () => {
    if (!isDirty || !draft || saveBusy) return;
    if (pendingGroupName) {
      const validation = validateDisplayName(pendingGroupName);
      if (validation) {
        setGroupNameError(
          t(
            displayNameErrorI18nKey(validation),
            validation === "too_long"
              ? { max: String(VAULT_DISPLAY_NAME_MAX_LENGTH) }
              : undefined,
          ),
        );
        setExpanded("groups");
        return;
      }
    }
    setGroupNameError(null);
    dismissFooterConfirm();
    setSaveConfirmOpen(true);
  };

  const commitSave = () => {
    if (!draft || !isDirty || saveBusy) return;
    if (commitSaveLock.current) return;
    commitSaveLock.current = true;
    const normalized = normalizeAppSettings({
      ...draft,
      app: { ...settings.app },
    });
    const settingsDirty = !appSettingsEqual(draft, settings);
    setSaveBusy(true);
    void (async () => {
      try {
        if (settingsDirty) {
          await replaceSettings(normalized);
          setDraft(normalized);
        }
        if (pendingGroupName) {
          await onCreateGroup?.(pendingGroupName, groupedVaultIds);
          setNewGroupName("");
          setGroupedVaultIds([]);
        }
        setSavedVisible(true);
        clearTimeout(savedHideRef.current);
        savedHideRef.current = setTimeout(() => setSavedVisible(false), SAVED_INDICATOR_MS);
        setSaveConfirmOpen(false);
      } catch (error) {
        setSaveConfirmOpen(false);
        if (isRpcError(error) && isVaultRootErrorCode(error.code)) {
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
        commitSaveLock.current = false;
        setSaveBusy(false);
      }
    })();
  };

  const formConfig = draft ?? settings;
  const saveBlocked = !isDirty || saveBusy || saveConfirmOpen;

  if (!open || !formConfig) return null;

  const footer = (
    <View style={styles.footerCol}>
      <View>
        {discardConfirmOpen ? (
          <Text style={typography.bodyMuted}>{t("modal.settings.discard_confirm")}</Text>
        ) : saveConfirmOpen ? (
          <Text style={typography.bodyMuted}>{t("modal.app_settings.save_confirm")}</Text>
        ) : savedVisible ? (
          <Text style={[typography.body, { color: colors.vaultStatusOpen }]}>
            {t("modal.settings.saved")}
          </Text>
        ) : null}
      </View>
      {discardConfirmOpen ? (
        <View style={styles.footerRow}>
          <Button
            variant="danger"
            label={t("modal.settings.discard_confirm_action")}
            onPress={handleDiscardAndClose}
          />
          <Button
            variant="ghost"
            label={t("modal.settings.discard_keep_editing")}
            onPress={dismissFooterConfirm}
          />
        </View>
      ) : (
        <View style={styles.footerRow}>
          <Button
            variant="primary"
            label={
              saveConfirmOpen ? t("modal.settings.save_confirm_action") : t("modal.settings.save")
            }
            disabled={saveConfirmOpen ? saveBusy : saveBlocked}
            onPress={saveConfirmOpen ? commitSave : handleSaveClick}
          />
          {saveConfirmOpen ? (
            <Button
              variant="ghost"
              label={t("modal.settings.save_cancel")}
              disabled={saveBusy}
              onPress={dismissFooterConfirm}
            />
          ) : null}
        </View>
      )}
    </View>
  );

  return (
    <>
      <Modal
        open={open}
        title={t("modal.app_settings.title")}
        onClose={requestClose}
        panelClassName="max-w-3xl"
        footer={footer}
      >
        <View style={styles.content} onTouchStart={dismissFooterConfirm}>
          {MOBILE_SETTINGS_SECTIONS.map((sectionId) => {
            const isOpen = expanded === sectionId;
            return (
              <View
                key={sectionId}
                style={[
                  styles.sectionCard,
                  {
                    backgroundColor: colors.surfaceContainer,
                    borderColor: colors.outlineVariant,
                  },
                ]}
              >
                <Pressable
                  onPress={() => setExpanded(isOpen ? "" : sectionId)}
                  style={styles.sectionHeader}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                >
                  <Text style={typography.headline}>
                    {t(`modal.app_settings.section.${sectionId}`)}
                  </Text>
                  <View
                    style={{
                      transform: [{ rotate: isOpen ? "0deg" : "-90deg" }],
                    }}
                  >
                    <Icon name="chevron-down" size={18} color={colors.onSurfaceVariant} />
                  </View>
                </Pressable>
                {isOpen ? (
                  <View style={styles.sectionBody}>
                    {sectionId === "appearance" ? (
                      <AppearanceFields
                        config={formConfig.ui}
                        onChange={(patch) => patchDraft("ui", patch)}
                      />
                    ) : null}
                    {sectionId === "groups" ? (
                      <GroupsFields
                        config={formConfig.ui}
                        onChange={(patch) => patchDraft("ui", patch)}
                        vaults={vaults}
                        groups={groups}
                        includeHidden={includeHidden}
                        newGroupName={newGroupName}
                        groupedVaultIds={groupedVaultIds}
                        nameError={groupNameError}
                        onNewGroupNameChange={(name) => {
                          setNewGroupName(name);
                          setGroupNameError(null);
                          setSaveConfirmOpen(false);
                          setDiscardConfirmOpen(false);
                        }}
                        onToggleGroupedVault={(vaultId) => {
                          setGroupedVaultIds((prev) =>
                            prev.includes(vaultId)
                              ? prev.filter((id) => id !== vaultId)
                              : [...prev, vaultId],
                          );
                          setSaveConfirmOpen(false);
                          setDiscardConfirmOpen(false);
                        }}
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
                        showHiddenVaultsSession={showHiddenVaultsSession}
                        onShowHiddenVaultsSessionChange={setShowHiddenVaultsSession}
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </Modal>
      <Toast message={message} onDismiss={dismiss} />
    </>
  );
}

function AppearanceFields({
  config,
  onChange,
}: {
  config: AppSettingsConfig["ui"];
  onChange: (patch: Partial<AppSettingsConfig["ui"]>) => void;
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  return (
    <View style={styles.fields}>
      <Text style={typography.caption}>{t("modal.app_settings.section.appearance_intro")}</Text>

      <FieldGroup
        label={t("modal.app_settings.field.locale")}
        hint={t("modal.app_settings.field.locale_help")}
      >
        <View
          style={styles.optionsCol}
          accessibilityRole="radiogroup"
          accessibilityLabel={t("modal.app_settings.field.locale")}
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
      </FieldGroup>

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
    </View>
  );
}

function GroupsFields({
  config,
  onChange,
  vaults,
  groups,
  includeHidden,
  newGroupName,
  groupedVaultIds,
  nameError,
  onNewGroupNameChange,
  onToggleGroupedVault,
}: {
  config: AppSettingsConfig["ui"];
  onChange: (patch: Partial<AppSettingsConfig["ui"]>) => void;
  vaults: VaultListItem[];
  groups: VaultGroup[];
  includeHidden: boolean;
  newGroupName: string;
  groupedVaultIds: string[];
  nameError: string | null;
  onNewGroupNameChange: (name: string) => void;
  onToggleGroupedVault: (vaultId: string) => void;
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  return (
    <View style={styles.fields}>
      <Text style={typography.caption}>{t("modal.app_settings.section.groups_intro")}</Text>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={typography.body}>
            {t("modal.app_settings.field.allow_drag_vault_into_group")}
          </Text>
          <Text style={typography.caption}>
            {t("modal.app_settings.field.allow_drag_vault_into_group_help")}
          </Text>
        </View>
        <Switch
          value={config.allow_drag_vault_into_group}
          onValueChange={(allow_drag_vault_into_group) => onChange({ allow_drag_vault_into_group })}
          trackColor={{ false: colors.outlineVariant, true: colors.accent }}
        />
      </View>
      <FieldGroup
        label={t("modal.app_settings.field.new_group_name")}
        hint={t("modal.app_settings.field.new_group_name_help")}
      >
        <TextInput
          value={newGroupName}
          maxLength={VAULT_DISPLAY_NAME_MAX_LENGTH}
          onChangeText={onNewGroupNameChange}
          placeholder={t("vault.group.create.name_label")}
          placeholderTextColor={colors.onSurfaceVariant}
          style={[
            typography.body,
            styles.input,
            {
              backgroundColor: colors.surfaceContainerHigh,
              borderColor: colors.outlineVariant,
              color: colors.onSurface,
            },
          ]}
        />
      </FieldGroup>
      {nameError ? (
        <Text style={[typography.caption, { color: colors.onErrorContainer }]}>{nameError}</Text>
      ) : null}
      <FieldGroup
        label={t("vault.group.create.grouped_vaults")}
        hint={t("vault.group.create.grouped_vaults_help")}
      >
        <GroupedVaultPicker
          vaults={vaults}
          groups={groups}
          includeHidden={includeHidden}
          selectedIds={groupedVaultIds}
          onToggle={onToggleGroupedVault}
        />
      </FieldGroup>
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
  const { colors, typography } = useTheme();

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
      <Text style={typography.caption}>{t("modal.app_settings.section.logging_intro")}</Text>

      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={typography.body}>{t("modal.app_settings.field.logging_enabled_label")}</Text>
          <Text style={typography.caption}>
            {t("modal.app_settings.field.logging_enabled_help")}
          </Text>
        </View>
        <Switch
          value={config.enabled}
          onValueChange={(enabled) => onChange({ enabled })}
          trackColor={{ false: colors.outlineVariant, true: colors.accent }}
        />
      </View>

      <FieldGroup
        label={t("modal.app_settings.field.logging_level")}
        hint={t("modal.app_settings.field.logging_level_help")}
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
      >
        <Select<string>
          value={keepLastValue}
          options={keepLastOptions}
          disabled={!config.enabled}
          label={t("modal.app_settings.field.logging_keep_last")}
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
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const { typography } = useTheme();
  return (
    <View style={styles.fieldGroup}>
      <Text style={typography.bodyMuted}>{label}</Text>
      {hint ? <Text style={typography.caption}>{hint}</Text> : null}
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
  const { colors, typography } = useTheme();
  return (
    <View style={styles.fields}>
      <Text style={typography.caption}>{t("modal.app_settings.section.hidden_vaults_intro")}</Text>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={typography.body}>
            {t("modal.app_settings.field.show_hidden_vaults_session")}
          </Text>
          <Text style={typography.caption}>
            {t("modal.app_settings.field.show_hidden_vaults_session_help")}
          </Text>
        </View>
        <Switch
          value={showHiddenVaultsSession}
          onValueChange={onShowHiddenVaultsSessionChange}
          trackColor={{ false: colors.outlineVariant, true: colors.accent }}
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={typography.body}>
            {t("modal.app_settings.field.always_show_hidden_vaults")}
          </Text>
          <Text style={typography.caption}>
            {t("modal.app_settings.field.always_show_hidden_vaults_help")}
          </Text>
        </View>
        <Switch
          value={alwaysShowHiddenVaults}
          onValueChange={onAlwaysShowHiddenVaultsChange}
          trackColor={{ false: colors.outlineVariant, true: colors.accent }}
        />
      </View>
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
  sectionCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  sectionBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  fields: { gap: spacing.md },
  fieldGroup: { gap: spacing.xs },
  optionsCol: { gap: spacing.sm },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  switchText: { flex: 1, gap: 4 },
  input: {
    borderRadius: radii.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 44,
  },
  footerCol: { gap: spacing.md },
  footerRow: { gap: spacing.sm },
});
