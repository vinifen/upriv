import { type ReactNode, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import {
  KDF_UNLOCK_OPTION_META,
  KDF_UNLOCK_PRESETS,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  VAULT_NOTE_MAX_LENGTH,
  VAULT_PASSWORD_HINT_MAX_LENGTH,
  WORKSPACE_PATH_DEFAULT,
  normalizeMountWorkspacePath,
  securityModeToUi,
  securityUiModesForStorage,
  storageModeIsPlaintext,
  uiToSecurityMode,
  validateMountWorkspacePath,
  vaultSettingsPreferenceSections,
  workspacePathIssueI18nKey,
  type KdfUnlockPreset,
  type PolicyRadioBadge,
  type SecurityUiMode,
  type StorageMode,
  type VaultGroup,
  type VaultSettingsConfig,
  type VaultSettingsSectionId,
  type WorkspacePathIssue,
  groupsForAssignmentPicker,
  groupAssignmentClearOption,
  requireVaultConfigEditLockedI18nKey,
} from "@upriv/shared";
import { useTranslation, type I18nKey } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import { Button, Select } from "@/components/ui";
import { PolicyRadioOption, SettingsAccordionSection } from "@/components/settings";
import {
  FieldHint,
  FieldLabel,
  RadioGroup,
  SwitchRow,
  ThemedInput,
  Warning,
} from "@/components/settings/settingsFields";
import { useVaultRootService } from "@/platform/services";

type PatchDraft = <S extends keyof VaultSettingsConfig>(
  section: S,
  patch: Partial<VaultSettingsConfig[S]>,
) => void;

const STORAGE_RADIOS: ReadonlyArray<{
  mode: StorageMode;
  badge?: PolicyRadioBadge;
  tone?: "default" | "insecure";
}> = [
  { mode: "encrypted_dir", badge: "recommended" },
  { mode: "upriv_plain", badge: "insecure", tone: "insecure" },
];

const STORAGE_WARNING: Partial<Record<StorageMode, I18nKey>> = {
  encrypted_dir: "warning.encrypted_dir_ram",
  upriv_plain: "warning.upriv_plain",
};

function securityOptionMeta(uiMode: SecurityUiMode): {
  badge?: PolicyRadioBadge;
  tone?: "default" | "less-secure" | "insecure";
} {
  switch (uiMode) {
    case "session_ram":
      return { badge: "recommended" };
    case "prompt_open_close":
      return { badge: "more-secure" };
    case "disk_close":
      return { badge: "less-secure", tone: "less-secure" };
    case "disk_open_close":
      return { badge: "insecure", tone: "insecure" };
    default:
      return {};
  }
}

interface VaultSettingsFormProps {
  draft: VaultSettingsConfig;
  patchDraft: PatchDraft;
  storageModeLocked?: boolean;
  displayNameLocked?: boolean;
  mountLocked?: boolean;
  securityModeLocked?: boolean;
  /** Resolved vault-root for reserved mount-path checks. */
  vaultRootPath?: string | null;
  onPathIssueChange?: (issue: WorkspacePathIssue | null) => void;
  hiddenLocked?: boolean;
  children?: ReactNode;
}

export function VaultSettingsForm({
  draft,
  patchDraft,
  storageModeLocked = false,
  displayNameLocked = false,
  mountLocked = false,
  securityModeLocked = false,
  vaultRootPath = null,
  onPathIssueChange,
  hiddenLocked = false,
  children,
}: VaultSettingsFormProps) {
  const { t } = useTranslation();
  const locks = {
    storageModeLocked,
    displayNameLocked,
    mountLocked,
    securityModeLocked,
    hiddenLocked,
  };

  return (
    <View style={styles.root}>
      {vaultSettingsPreferenceSections(draft.storage.mode).map((sectionId) => (
        <SettingsAccordionSection
          key={sectionId}
          title={t(`modal.settings.section.${sectionId}` as I18nKey)}
          defaultOpen={sectionId === "vault"}
        >
          {renderSection(sectionId, draft, patchDraft, locks, vaultRootPath, onPathIssueChange)}
        </SettingsAccordionSection>
      ))}
      {children}
    </View>
  );
}

function renderSection(
  sectionId: VaultSettingsSectionId,
  draft: VaultSettingsConfig,
  patchDraft: PatchDraft,
  locks: {
    storageModeLocked: boolean;
    displayNameLocked: boolean;
    mountLocked: boolean;
    securityModeLocked: boolean;
    hiddenLocked: boolean;
  },
  vaultRootPath: string | null,
  onPathIssueChange?: (issue: WorkspacePathIssue | null) => void,
) {
  switch (sectionId) {
    case "vault":
      return (
        <VaultSection
          config={draft.vault}
          hiddenLocked={locks.hiddenLocked}
          displayNameLocked={locks.displayNameLocked}
          onChange={(patch) => patchDraft("vault", patch)}
        />
      );
    case "storage":
      return (
        <StorageSection
          config={draft.storage}
          locked={locks.storageModeLocked}
          onChange={(patch) => patchDraft("storage", patch)}
        />
      );
    case "mount":
      return (
        <VaultSettingsMountSection
          config={draft.mount}
          vaultRootPath={vaultRootPath}
          controlsDisabled={locks.mountLocked}
          onPathIssueChange={onPathIssueChange}
          onChange={(patch) => patchDraft("mount", patch)}
        />
      );
    case "auto_close":
      return (
        <AutoCloseSection
          autoClose={draft.auto_close}
          secureWipe={draft.security.secure_wipe_workspace}
          requireUnmountOnSleep={draft.policy.require_unmount_on_sleep}
          onAutoCloseChange={(patch) => patchDraft("auto_close", patch)}
          onSecureWipeChange={(secure_wipe_workspace) =>
            patchDraft("security", { secure_wipe_workspace })
          }
          onRequireUnmountOnSleepChange={(require_unmount_on_sleep) =>
            patchDraft("policy", { require_unmount_on_sleep })
          }
        />
      );
    case "backup":
      return (
        <BackupSection config={draft.backup} onChange={(patch) => patchDraft("backup", patch)} />
      );
    case "security":
      return (
        <SecuritySection
          storageMode={draft.storage.mode}
          config={draft.security}
          passwordHint={draft.vault.password_hint}
          securityModeLocked={locks.securityModeLocked}
          onChange={(patch) => patchDraft("security", patch)}
          onPasswordHintChange={(password_hint) => patchDraft("vault", { password_hint })}
        />
      );
    case "policy":
      return (
        <PolicySection config={draft.policy} onChange={(patch) => patchDraft("policy", patch)} />
      );
    default:
      return null;
  }
}

function VaultSection({
  config,
  onChange,
  hiddenLocked = false,
  displayNameLocked = false,
}: {
  config: VaultSettingsConfig["vault"];
  onChange: (patch: Partial<VaultSettingsConfig["vault"]>) => void;
  hiddenLocked?: boolean;
  displayNameLocked?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.fields}>
      <FieldLabel disabled={displayNameLocked}>
        {t("modal.settings.field.vault.display_name")}
      </FieldLabel>
      {displayNameLocked ? (
        <FieldHint>{t(requireVaultConfigEditLockedI18nKey("vault.display_name"))}</FieldHint>
      ) : null}
      <ThemedInput
        value={config.display_name}
        maxLength={VAULT_DISPLAY_NAME_MAX_LENGTH}
        disabled={displayNameLocked}
        onChangeText={(display_name) => onChange({ display_name })}
      />
      <FieldLabel>{t("modal.settings.field.vault.order")}</FieldLabel>
      <FieldHint>{t("modal.settings.field.vault.order_help")}</FieldHint>
      <ThemedInput
        keyboardType="number-pad"
        value={String(config.order)}
        onChangeText={(raw) => onChange({ order: Math.max(0, Number.parseInt(raw, 10) || 0) })}
        mono
      />
      <FieldLabel>{t("modal.settings.note")}</FieldLabel>
      <FieldHint>
        {t("modal.settings.field.vault.note_help", { max: String(VAULT_NOTE_MAX_LENGTH) })}
      </FieldHint>
      <ThemedInput
        value={config.note}
        maxLength={VAULT_NOTE_MAX_LENGTH}
        onChangeText={(note) => onChange({ note })}
        multiline
        style={styles.multiline}
      />
      <SwitchRow
        label={t("modal.settings.field.vault.hidden")}
        hint={
          hiddenLocked
            ? t("modal.settings.field.vault.hidden_locked_by_group")
            : t("modal.settings.field.vault.hidden_help")
        }
        value={config.hidden || hiddenLocked}
        disabled={hiddenLocked}
        onValueChange={(hidden) => onChange({ hidden })}
      />
    </View>
  );
}

function StorageSection({
  config,
  locked,
  onChange,
}: {
  config: VaultSettingsConfig["storage"];
  locked: boolean;
  onChange: (patch: Partial<VaultSettingsConfig["storage"]>) => void;
}) {
  const { t } = useTranslation();
  const warning = STORAGE_WARNING[config.mode];
  return (
    <View style={styles.fields}>
      <FieldHint>{t("modal.settings.section.storage_intro")}</FieldHint>
      <FieldLabel>{t("modal.settings.field.storage.mode")}</FieldLabel>
      <FieldHint>{t("modal.settings.field.storage.mode_help")}</FieldHint>
      {locked ? (
        <FieldHint>{t(requireVaultConfigEditLockedI18nKey("storage.mode"))}</FieldHint>
      ) : null}
      <RadioGroup>
        {STORAGE_RADIOS.map(({ mode, badge, tone }) => (
          <PolicyRadioOption
            key={mode}
            value={mode}
            checked={config.mode === mode}
            disabled={locked || mode === "upriv_plain"}
            title={t(`modal.settings.option.storage.${mode}` as I18nKey)}
            description={t(`modal.settings.option.storage.${mode}_desc` as I18nKey)}
            badge={badge}
            tone={tone}
            onSelect={() => onChange({ mode })}
          />
        ))}
      </RadioGroup>
      {warning ? <FieldHint>{t(warning)}</FieldHint> : null}
      <FieldHint>{t("error.upriv_plain_unavailable")}</FieldHint>
    </View>
  );
}

export function VaultSettingsMountSection({
  config,
  onChange,
  vaultRootPath = null,
  onPathIssueChange,
  controlsDisabled = false,
}: {
  config: VaultSettingsConfig["mount"];
  onChange: (patch: Partial<VaultSettingsConfig["mount"]>) => void;
  vaultRootPath?: string | null;
  onPathIssueChange?: (issue: WorkspacePathIssue | null) => void;
  controlsDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const vaultRootService = useVaultRootService();
  const customDraftRef = useRef("");
  const storedIsDefault =
    normalizeMountWorkspacePath(config.workspace_path) === WORKSPACE_PATH_DEFAULT;
  const [uiMode, setUiMode] = useState<"default" | "custom">(
    storedIsDefault ? "default" : "custom",
  );

  useEffect(() => {
    if (!storedIsDefault) setUiMode("custom");
  }, [storedIsDefault]);

  const customPath = storedIsDefault ? "" : config.workspace_path;
  const pathIssue: WorkspacePathIssue | null =
    uiMode === "custom"
      ? !customPath.trim()
        ? "empty"
        : validateMountWorkspacePath(customPath, vaultRootPath)
      : null;

  useEffect(() => {
    onPathIssueChange?.(pathIssue);
  }, [onPathIssueChange, pathIssue]);

  return (
    <View style={styles.fields}>
      <FieldHint>{t("modal.settings.section.mount_intro")}</FieldHint>
      {controlsDisabled ? (
        <FieldHint>{t(requireVaultConfigEditLockedI18nKey("mount.workspace_path"))}</FieldHint>
      ) : null}
      <RadioGroup>
        <PolicyRadioOption
          value="default"
          checked={uiMode === "default"}
          disabled={controlsDisabled}
          title={t("modal.settings.field.mount.use_default")}
          description={t("modal.settings.field.mount.use_default_desc")}
          badge="default"
          onSelect={() => {
            if (controlsDisabled) return;
            if (!storedIsDefault && config.workspace_path.trim()) {
              customDraftRef.current = config.workspace_path.trim();
            }
            setUiMode("default");
            onChange({ workspace_path: WORKSPACE_PATH_DEFAULT });
          }}
        />
        <PolicyRadioOption
          value="custom"
          checked={uiMode === "custom"}
          disabled={controlsDisabled}
          title={t("modal.settings.field.mount.custom")}
          description={t("modal.settings.field.mount.custom_desc")}
          onSelect={() => {
            if (controlsDisabled) return;
            setUiMode("custom");
            if (storedIsDefault) {
              onChange({ workspace_path: customDraftRef.current });
            }
          }}
          footer={
            uiMode === "custom" ? (
              <View style={styles.fields}>
                <FieldLabel disabled={controlsDisabled}>
                  {t("modal.settings.field.mount.path")}
                </FieldLabel>
                <FieldHint disabled={controlsDisabled}>
                  {t("modal.settings.field.mount.path_help")}
                </FieldHint>
                <ThemedInput
                  value={customPath}
                  disabled={controlsDisabled}
                  placeholder={t("modal.app_settings.field.workspace.path_placeholder")}
                  onChangeText={(next) => {
                    customDraftRef.current = next.trim();
                    onChange({ workspace_path: next });
                  }}
                  mono
                />
                <Button
                  size="sm"
                  variant="ghost"
                  label={t("modal.app_settings.action.pick_workspace_folder")}
                  disabled={controlsDisabled || Platform.OS !== "android"}
                  onPress={() => {
                    void (async () => {
                      const picked = await vaultRootService.pickFolder(
                        customPath.trim() || null,
                        t("modal.app_settings.action.pick_workspace_folder"),
                      );
                      if (!picked?.trim()) return;
                      customDraftRef.current = picked.trim();
                      onChange({ workspace_path: picked.trim() });
                    })();
                  }}
                />
                {Platform.OS !== "android" ? (
                  <FieldHint>{t("error.unsupported_platform")}</FieldHint>
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
            ) : undefined
          }
        />
      </RadioGroup>
    </View>
  );
}

function AutoCloseSection({
  autoClose,
  secureWipe,
  requireUnmountOnSleep,
  onAutoCloseChange,
  onSecureWipeChange,
  onRequireUnmountOnSleepChange,
}: {
  autoClose: VaultSettingsConfig["auto_close"];
  secureWipe: boolean;
  requireUnmountOnSleep: boolean;
  onAutoCloseChange: (patch: Partial<VaultSettingsConfig["auto_close"]>) => void;
  onSecureWipeChange: (secureWipe: boolean) => void;
  onRequireUnmountOnSleepChange: (requireUnmountOnSleep: boolean) => void;
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.fields}>
      <SwitchRow
        label={t("modal.settings.field.close.secure_wipe")}
        value={secureWipe}
        onValueChange={onSecureWipeChange}
      />
      {!secureWipe ? (
        <FieldHint>{t("modal.settings.field.close.secure_wipe_warn")}</FieldHint>
      ) : null}

      <SwitchRow
        label={t("modal.settings.field.auto_close.enabled")}
        value={autoClose.enabled}
        onValueChange={(enabled) => onAutoCloseChange({ enabled })}
      />
      <FieldLabel disabled={!autoClose.enabled}>
        {t("modal.settings.field.auto_close.idle_minutes")}
      </FieldLabel>
      <ThemedInput
        keyboardType="number-pad"
        disabled={!autoClose.enabled}
        value={String(autoClose.idle_minutes)}
        onChangeText={(raw) =>
          onAutoCloseChange({
            idle_minutes: Math.min(1440, Math.max(1, Number.parseInt(raw, 10) || 1)),
          })
        }
        mono
      />
      <FieldLabel disabled={!autoClose.enabled}>
        {t("modal.settings.field.auto_close.warn_before_seconds")}
      </FieldLabel>
      <ThemedInput
        keyboardType="number-pad"
        disabled={!autoClose.enabled}
        value={String(autoClose.warn_before_seconds)}
        onChangeText={(raw) =>
          onAutoCloseChange({
            warn_before_seconds: Math.min(300, Math.max(0, Number.parseInt(raw, 10) || 0)),
          })
        }
        mono
      />

      <SwitchRow
        label={t("modal.settings.field.close.require_unmount_on_sleep")}
        hint={t("modal.settings.field.close.require_unmount_on_sleep_help")}
        value={requireUnmountOnSleep}
        onValueChange={onRequireUnmountOnSleepChange}
      />
    </View>
  );
}

function BackupSection({
  config,
  onChange,
}: {
  config: VaultSettingsConfig["backup"];
  onChange: (patch: Partial<VaultSettingsConfig["backup"]>) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.fields}>
      <SwitchRow
        label={t("modal.settings.field.backup.enabled")}
        value={config.enabled}
        onValueChange={(enabled) => onChange({ enabled })}
      />
      <Select
        label={t("modal.settings.field.backup.mode")}
        value={config.mode}
        disabled={!config.enabled}
        options={[
          { value: "keep_last", label: t("modal.settings.option.backup.keep_last") },
          { value: "keep_all", label: t("modal.settings.option.backup.keep_all") },
        ]}
        onChange={(mode) => onChange({ mode })}
      />
      <FieldLabel disabled={!config.enabled || config.mode !== "keep_last"}>
        {t("modal.settings.field.backup.keep_last")}
      </FieldLabel>
      <ThemedInput
        keyboardType="number-pad"
        disabled={!config.enabled || config.mode !== "keep_last"}
        value={String(config.keep_last)}
        onChangeText={(raw) =>
          onChange({ keep_last: Math.min(99, Math.max(1, Number.parseInt(raw, 10) || 1)) })
        }
        mono
      />
    </View>
  );
}

function SecuritySection({
  storageMode,
  config,
  passwordHint,
  onChange,
  onPasswordHintChange,
  securityModeLocked = false,
}: {
  storageMode: StorageMode;
  config: VaultSettingsConfig["security"];
  passwordHint: string;
  onChange: (patch: Partial<VaultSettingsConfig["security"]>) => void;
  onPasswordHintChange: (passwordHint: string) => void;
  securityModeLocked?: boolean;
}) {
  const { t } = useTranslation();
  const selectedUi = securityModeToUi(config.mode);
  const modes = securityUiModesForStorage(storageMode);
  return (
    <View style={styles.fields}>
      <FieldLabel disabled={securityModeLocked}>
        {t("modal.settings.field.security.mode")}
      </FieldLabel>
      <FieldHint disabled={securityModeLocked}>
        {securityModeLocked
          ? t(requireVaultConfigEditLockedI18nKey("security.mode"))
          : storageModeIsPlaintext(storageMode)
            ? t("modal.settings.field.security.mode_help_plain")
            : t("modal.settings.field.security.mode_help")}
      </FieldHint>
      <RadioGroup>
        {modes.map((uiMode) => {
          const meta = securityOptionMeta(uiMode);
          return (
            <PolicyRadioOption
              key={uiMode}
              value={uiMode}
              checked={selectedUi === uiMode}
              disabled={securityModeLocked}
              title={t(`modal.settings.option.security.${uiMode}` as I18nKey)}
              description={t(`modal.settings.option.security.${uiMode}_desc` as I18nKey)}
              badge={meta.badge}
              tone={meta.tone}
              onSelect={() => onChange({ mode: uiToSecurityMode(uiMode) })}
            />
          );
        })}
      </RadioGroup>
      <FieldLabel>{t("modal.settings.password_hint")}</FieldLabel>
      <FieldHint>{t("modal.settings.field.security.password_hint_help")}</FieldHint>
      <ThemedInput
        value={passwordHint}
        maxLength={VAULT_PASSWORD_HINT_MAX_LENGTH}
        onChangeText={onPasswordHintChange}
      />
    </View>
  );
}

export function KdfSection({
  config,
  onChange,
  choosesPreset = true,
}: {
  config: { unlock_preset: KdfUnlockPreset };
  onChange: (patch: Partial<{ unlock_preset: KdfUnlockPreset }>) => void;
  choosesPreset?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.fields}>
      <FieldLabel disabled={!choosesPreset}>
        {t("modal.settings.field.kdf.unlock_preset")}
      </FieldLabel>
      <FieldHint disabled={!choosesPreset}>{t("modal.settings.section.kdf_intro")}</FieldHint>
      <RadioGroup>
        {KDF_UNLOCK_PRESETS.map((preset) => {
          const meta = KDF_UNLOCK_OPTION_META[preset];
          return (
            <PolicyRadioOption
              key={preset}
              value={preset}
              checked={config.unlock_preset === preset}
              disabled={!choosesPreset}
              title={t(meta.titleKey)}
              description={t(meta.descKey)}
              badge={meta.badge}
              tone={meta.tone}
              onSelect={() => onChange({ unlock_preset: preset })}
            />
          );
        })}
      </RadioGroup>
      {!choosesPreset ? (
        <FieldHint>{t("modal.settings.field.kdf.import_package")}</FieldHint>
      ) : null}
    </View>
  );
}

function PolicySection({
  config,
  onChange,
}: {
  config: VaultSettingsConfig["policy"];
  onChange: (patch: Partial<VaultSettingsConfig["policy"]>) => void;
}) {
  const { t } = useTranslation();
  const externalBlockCopy = config.allow_external_editors && config.disallow_copy_outside_mount;
  return (
    <View style={styles.fields}>
      <FieldLabel>{t("modal.settings.field.policy.external_editors")}</FieldLabel>
      <FieldHint>{t("modal.settings.field.policy.external_editors_help")}</FieldHint>
      <RadioGroup>
        <PolicyRadioOption
          value="no"
          checked={!config.allow_external_editors}
          title={t("modal.settings.option.policy.external_editors_no")}
          description={t("modal.settings.option.policy.external_editors_no_desc")}
          badge="recommended"
          onSelect={() => onChange({ allow_external_editors: false })}
        />
        <PolicyRadioOption
          value="yes"
          checked={config.allow_external_editors}
          title={t("modal.settings.option.policy.external_editors_yes")}
          description={t("modal.settings.option.policy.external_editors_yes_desc")}
          badge="less-secure"
          tone="less-secure"
          onSelect={() => onChange({ allow_external_editors: true })}
        />
      </RadioGroup>
      <FieldLabel>{t("modal.settings.field.policy.copy_outside")}</FieldLabel>
      <FieldHint>{t("modal.settings.field.policy.copy_outside_help")}</FieldHint>
      <RadioGroup>
        <PolicyRadioOption
          value="block"
          checked={config.disallow_copy_outside_mount}
          title={t("modal.settings.option.policy.copy_block")}
          description={t("modal.settings.option.policy.copy_block_desc")}
          badge="recommended"
          onSelect={() => onChange({ disallow_copy_outside_mount: true })}
        />
        <PolicyRadioOption
          value="allow"
          checked={!config.disallow_copy_outside_mount}
          title={t("modal.settings.option.policy.copy_allow")}
          description={t("modal.settings.option.policy.copy_allow_desc")}
          badge="less-secure"
          tone="less-secure"
          onSelect={() => onChange({ disallow_copy_outside_mount: false })}
        />
      </RadioGroup>
      {config.allow_external_editors ? <FieldHint>{t("warning.external_editor")}</FieldHint> : null}
      {externalBlockCopy ? <FieldHint>{t("warning.policy.external_block_copy")}</FieldHint> : null}
    </View>
  );
}

export function VaultSettingsGroupSection({
  groups,
  selectedGroupId,
  newGroupName,
  nameError,
  includeHidden = false,
  onSelectedGroupIdChange,
  onNewGroupNameChange,
}: {
  groups: readonly VaultGroup[];
  selectedGroupId: string;
  newGroupName: string;
  nameError: string | null;
  includeHidden?: boolean;
  onSelectedGroupIdChange: (groupId: string) => void;
  onNewGroupNameChange: (name: string) => void;
}) {
  const { t } = useTranslation();
  const creating = Boolean(newGroupName.trim());
  const pickerGroups = groupsForAssignmentPicker(groups, { includeHidden, selectedGroupId });
  const groupOptions = [
    groupAssignmentClearOption(creating ? "" : selectedGroupId, t),
    ...pickerGroups.map((group) => ({ value: group.id, label: group.displayName })),
  ];
  return (
    <View style={styles.fields}>
      <FieldHint>{t("modal.settings.field.group.new_name_help")}</FieldHint>
      <Select
        label={t("vault.group.assignment.section")}
        value={creating ? "" : selectedGroupId}
        options={groupOptions}
        disabled={creating}
        onChange={onSelectedGroupIdChange}
      />
      <FieldLabel>{t("modal.settings.field.group.new_name")}</FieldLabel>
      <ThemedInput
        value={newGroupName}
        maxLength={VAULT_DISPLAY_NAME_MAX_LENGTH}
        onChangeText={onNewGroupNameChange}
        placeholder={t("vault.group.create.name_label")}
      />
      {nameError ? <Warning>{nameError}</Warning> : null}
      <FieldHint>{t("vault.create.group_create_help")}</FieldHint>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  fields: { gap: spacing.md },
  multiline: { minHeight: 88, textAlignVertical: "top" },
});
