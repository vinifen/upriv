import { StyleSheet, Text, View } from "react-native";
import {
  createVaultChoosesKdf,
  createVaultErrorI18nKey,
  createVaultErrorsForField,
  createVaultImportNeedsRename,
  importDisplayNameFromFilename,
  isHiddenGroup,
  groupsForAssignmentPicker,
  groupAssignmentClearOption,
  NO_VAULT_GROUPS,
  normalizeSecurityModeForStorage,
  securityModeToUi,
  securityUiModesForStorage,
  storageModeIsPlaintext,
  uiToSecurityMode,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  VAULT_NOTE_MAX_LENGTH,
  VAULT_PASSWORD_HINT_MAX_LENGTH,
  type CreateVaultDraft,
  type CreateVaultStepId,
  type CreateVaultValidationCode,
  type SecurityUiMode,
  type StorageMode,
  type VaultGroup,
} from "@upriv/shared";
import { useCreateVaultService } from "@/platform/services";
import { useTranslation, type I18nKey } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import { Button, Select } from "@/components/ui";
import { PolicyRadioOption, SettingsAccordionSection } from "@/components/settings";
import {
  FieldHint,
  FieldLabel,
  PasswordInput,
  RadioGroup,
  SwitchRow,
  ThemedInput,
} from "@/components/settings/settingsFields";
import {
  KdfSection,
  VaultSettingsMountSection,
} from "@/features/vaults/settings/vaultSettingsForm";
import type { CreateVaultStepFocusProps } from "@upriv/shared/react";

interface StepProps extends Partial<CreateVaultStepFocusProps> {
  draft: CreateVaultDraft;
  errors: readonly CreateVaultValidationCode[];
  onChange: (patch: Partial<CreateVaultDraft>) => void;
  groups?: readonly VaultGroup[];
  includeHidden?: boolean;
  /** Resolved vault-root for mount reserved checks (from wizard / CreateVaultModal). */
  vaultRootPath?: string | null;
}

export function renderCreateVaultStep(
  stepId: CreateVaultStepId,
  props: StepProps & {
    onTestImportPassword?: () => void;
    testingPassword?: boolean;
  },
) {
  switch (stepId) {
    case "source":
      return <CreateVaultSourceStep {...props} />;
    case "identity":
      return <CreateVaultIdentityStep {...props} />;
    case "password":
      return <CreateVaultPasswordStep {...props} />;
    case "general":
      return <CreateVaultGeneralStep {...props} />;
    case "advanced":
      return <CreateVaultAdvancedStep {...props} />;
    default:
      return null;
  }
}

function FieldErrors({ errors }: { errors: readonly CreateVaultValidationCode[] }) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  if (errors.length === 0) return null;
  return (
    <View accessibilityRole="alert" style={styles.fieldErrors}>
      {errors.map((code) => (
        <Text key={code} style={[typography.caption, { color: colors.onErrorContainer }]}>
          {t(
            createVaultErrorI18nKey(code) as I18nKey,
            code === "too_long" || code === "group_name_too_long"
              ? { max: String(VAULT_DISPLAY_NAME_MAX_LENGTH) }
              : undefined,
          )}
        </Text>
      ))}
    </View>
  );
}

function securityOptionMeta(uiMode: SecurityUiMode): {
  badge?: "recommended" | "less-secure" | "insecure" | "default" | "more-secure";
  tone?: "default" | "less-secure" | "insecure";
} {
  if (uiMode === "session_ram") return { badge: "recommended" };
  if (uiMode === "prompt_open_close") return { badge: "more-secure" };
  if (uiMode === "disk_open_close") return { badge: "insecure", tone: "insecure" };
  if (uiMode === "disk_close") return { badge: "less-secure", tone: "less-secure" };
  return {};
}

function CreateVaultSourceStep({ draft, errors, onChange }: StepProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  const createVaultService = useCreateVaultService();

  const chooseImportFile = () => {
    const { fileName, path } = createVaultService.selectImportPackageForProbe();
    onChange({
      source: "import",
      importFileName: fileName,
      importFilePath: path,
      displayName: importDisplayNameFromFilename(fileName).displayName,
      password: "",
      passwordConfirm: "",
      passwordValidated: false,
      passwordTestFailed: false,
    });
  };

  const importFilePicker = (
    <View style={styles.fields}>
      <ThemedInput
        value={draft.importFileName}
        editable={false}
        placeholder={t("vault.create.import_file_placeholder")}
        mono
      />
      <Button
        label={t("vault.create.action.choose_file")}
        variant="ghost"
        onPress={chooseImportFile}
      />
    </View>
  );

  return (
    <View style={styles.fields}>
      <Text style={typography.bodyMuted}>{t("vault.create.source_intro")}</Text>
      <RadioGroup>
        <PolicyRadioOption
          value="scratch"
          checked={draft.source === "scratch"}
          title={t("vault.create.option.scratch")}
          description={t("vault.create.option.scratch_desc")}
          badge="default"
          onSelect={() =>
            onChange({
              source: "scratch",
              importFileName: "",
              importFilePath: "",
              passwordValidated: false,
              passwordTestFailed: false,
            })
          }
        />
        <PolicyRadioOption
          value="import"
          checked={draft.source === "import"}
          title={t("vault.create.option.import")}
          description={t("vault.create.option.import_desc")}
          footer={importFilePicker}
          onSelect={() =>
            onChange({
              source: "import",
              password: "",
              passwordConfirm: "",
              passwordValidated: false,
              passwordTestFailed: false,
            })
          }
        />
      </RadioGroup>
      <FieldErrors errors={createVaultErrorsForField(errors, "source")} />
    </View>
  );
}

function CreateVaultIdentityStep({
  draft,
  errors,
  onChange,
  bindFieldRef,
  onFieldFocus,
  onAdvanceStep,
}: StepProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  const importNeedsRename = createVaultImportNeedsRename(draft);
  return (
    <View style={styles.fields}>
      <Text style={typography.bodyMuted}>{t("vault.create.identity_intro")}</Text>
      {importNeedsRename ? (
        <Text style={typography.bodyMuted}>{t("vault.import.rename_prompt")}</Text>
      ) : null}
      <FieldLabel>
        {importNeedsRename ? t("vault.import.suggested_name") : t("vault.name.label")}
      </FieldLabel>
      <ThemedInput
        ref={bindFieldRef?.("displayName")}
        value={draft.displayName}
        maxLength={VAULT_DISPLAY_NAME_MAX_LENGTH}
        onFocus={() => onFieldFocus?.("displayName")}
        onChangeText={(displayName) => onChange({ displayName })}
        returnKeyType="next"
        onSubmitEditing={() => onAdvanceStep?.()}
      />
      <FieldErrors errors={createVaultErrorsForField(errors, "displayName")} />
      <FieldLabel>{t("vault.create.note")}</FieldLabel>
      <FieldHint>{t("vault.create.note_help", { max: String(VAULT_NOTE_MAX_LENGTH) })}</FieldHint>
      <ThemedInput
        ref={bindFieldRef?.("note")}
        value={draft.note}
        maxLength={VAULT_NOTE_MAX_LENGTH}
        onFocus={() => onFieldFocus?.("note")}
        onChangeText={(note) => onChange({ note })}
        multiline
        style={styles.multiline}
      />
    </View>
  );
}

function CreateVaultPasswordStep({
  draft,
  errors,
  onChange,
  onTestImportPassword,
  testingPassword = false,
  bindFieldRef,
  onFieldFocus,
  onAdvanceStep,
}: StepProps & { onTestImportPassword?: () => void; testingPassword?: boolean }) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const isImport = draft.source === "import";

  return (
    <View style={styles.fields}>
      <Text style={typography.bodyMuted}>
        {isImport
          ? t("vault.create.password_import_intro")
          : t("vault.create.password_scratch_intro")}
      </Text>
      <FieldLabel>{t("vault.create.password")}</FieldLabel>
      <PasswordInput
        value={draft.password}
        ref={bindFieldRef?.("password")}
        autoComplete="password-new"
        onFocus={() => onFieldFocus?.("password")}
        onSubmitEditing={() => onAdvanceStep?.()}
        returnKeyType="next"
        onChangeText={(password) =>
          onChange({
            password,
            passwordValidated: false,
            passwordTestFailed: false,
          })
        }
      />
      <FieldErrors errors={createVaultErrorsForField(errors, "password")} />
      {!isImport ? (
        <>
          <FieldLabel>{t("vault.create.password_confirm")}</FieldLabel>
          <PasswordInput
            value={draft.passwordConfirm}
            ref={bindFieldRef?.("passwordConfirm")}
            autoComplete="password-new"
            onFocus={() => onFieldFocus?.("passwordConfirm")}
            onSubmitEditing={() => onAdvanceStep?.()}
            returnKeyType="next"
            onChangeText={(passwordConfirm) => onChange({ passwordConfirm })}
          />
          <FieldErrors errors={createVaultErrorsForField(errors, "passwordConfirm")} />
        </>
      ) : (
        <View style={styles.row}>
          <Button
            label={
              testingPassword
                ? t("vault.create.action.testing_password")
                : t("vault.create.action.test_password")
            }
            variant="ghost"
            disabled={!draft.password.trim() || testingPassword}
            busy={testingPassword}
            onPress={onTestImportPassword}
          />
          {draft.passwordValidated ? (
            <Text style={[typography.body, { color: colors.vaultStatusOpen }]}>
              {t("vault.create.password_validated")}
            </Text>
          ) : null}
        </View>
      )}
      <FieldLabel>{t("vault.create.password_hint")}</FieldLabel>
      <FieldHint>{t("vault.create.password_hint_help")}</FieldHint>
      <ThemedInput
        ref={bindFieldRef?.("passwordHint")}
        value={draft.passwordHint}
        maxLength={VAULT_PASSWORD_HINT_MAX_LENGTH}
        onFocus={() => onFieldFocus?.("passwordHint")}
        onChangeText={(passwordHint) => onChange({ passwordHint })}
      />
    </View>
  );
}

function CreateVaultGeneralStep({
  draft,
  errors,
  onChange,
  groups = NO_VAULT_GROUPS,
  includeHidden = false,
}: StepProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  const creatingGroup = Boolean(draft.groupName.trim());
  const groupSelectValue = draft.groupMode === "existing" ? draft.groupId : "";
  const pickerGroups = groupsForAssignmentPicker(groups, {
    includeHidden,
    selectedGroupId: groupSelectValue,
  });
  const groupOptions = [
    groupAssignmentClearOption(groupSelectValue, t),
    ...pickerGroups.map((group) => ({ value: group.id, label: group.displayName })),
  ];

  return (
    <View style={styles.fields}>
      <Text style={typography.bodyMuted}>{t("vault.create.general_intro")}</Text>

      <SettingsAccordionSection title={t("modal.settings.section.auto_close")} defaultOpen>
        <View style={styles.fields}>
          <SwitchRow
            label={t("modal.settings.field.auto_close.enabled")}
            value={draft.auto_close.enabled}
            onValueChange={(enabled) => onChange({ auto_close: { ...draft.auto_close, enabled } })}
          />
          <FieldLabel disabled={!draft.auto_close.enabled}>
            {t("modal.settings.field.auto_close.idle_minutes")}
          </FieldLabel>
          <ThemedInput
            keyboardType="number-pad"
            disabled={!draft.auto_close.enabled}
            value={String(draft.auto_close.idle_minutes)}
            onChangeText={(raw) =>
              onChange({
                auto_close: {
                  ...draft.auto_close,
                  idle_minutes: Math.min(1440, Math.max(1, Number.parseInt(raw, 10) || 1)),
                },
              })
            }
            mono
          />
          <FieldLabel disabled={!draft.auto_close.enabled}>
            {t("modal.settings.field.auto_close.warn_before_seconds")}
          </FieldLabel>
          <ThemedInput
            keyboardType="number-pad"
            disabled={!draft.auto_close.enabled}
            value={String(draft.auto_close.warn_before_seconds)}
            onChangeText={(raw) =>
              onChange({
                auto_close: {
                  ...draft.auto_close,
                  warn_before_seconds: Math.min(300, Math.max(0, Number.parseInt(raw, 10) || 0)),
                },
              })
            }
            mono
          />
        </View>
      </SettingsAccordionSection>

      <SettingsAccordionSection title={t("modal.settings.section.backup")} defaultOpen>
        <View style={styles.fields}>
          <SwitchRow
            label={t("modal.settings.field.backup.enabled")}
            value={draft.backup.enabled}
            onValueChange={(enabled) => onChange({ backup: { ...draft.backup, enabled } })}
          />
          <Select
            label={t("modal.settings.field.backup.mode")}
            value={draft.backup.mode}
            disabled={!draft.backup.enabled}
            options={[
              { value: "keep_last", label: t("modal.settings.option.backup.keep_last") },
              { value: "keep_all", label: t("modal.settings.option.backup.keep_all") },
            ]}
            onChange={(mode) => onChange({ backup: { ...draft.backup, mode } })}
          />
          <FieldLabel disabled={!draft.backup.enabled || draft.backup.mode !== "keep_last"}>
            {t("modal.settings.field.backup.keep_last")}
          </FieldLabel>
          <ThemedInput
            keyboardType="number-pad"
            disabled={!draft.backup.enabled || draft.backup.mode !== "keep_last"}
            value={String(draft.backup.keep_last)}
            onChangeText={(raw) =>
              onChange({
                backup: {
                  ...draft.backup,
                  keep_last: Math.min(99, Math.max(1, Number.parseInt(raw, 10) || 1)),
                },
              })
            }
            mono
          />
        </View>
      </SettingsAccordionSection>

      <SettingsAccordionSection title={t("vault.group.assignment.section")} defaultOpen>
        <View style={styles.fields}>
          <Text style={typography.bodyMuted}>{t("vault.create.group_intro")}</Text>
          <Select
            label={t("vault.group.assignment.section")}
            value={groupSelectValue}
            options={groupOptions}
            disabled={creatingGroup}
            onChange={(nextId) => {
              if (!nextId) {
                onChange({ groupMode: "none", groupId: "", groupName: "" });
                return;
              }
              onChange({
                groupMode: "existing",
                groupId: nextId,
                groupName: "",
                ...(isHiddenGroup(groups, nextId) ? { hidden: true } : {}),
              });
            }}
          />
          <FieldErrors errors={createVaultErrorsForField(errors, "group")} />
          <FieldLabel>{t("modal.settings.field.group.new_name")}</FieldLabel>
          <ThemedInput
            value={draft.groupName}
            maxLength={VAULT_DISPLAY_NAME_MAX_LENGTH}
            onChangeText={(groupName) => {
              if (groupName.trim()) {
                onChange({ groupMode: "create", groupName });
                return;
              }
              onChange({
                groupMode: draft.groupId ? "existing" : "none",
                groupName: "",
              });
            }}
            placeholder={t("vault.group.create.name_label")}
          />
          <FieldHint>{t("vault.create.group_create_help")}</FieldHint>
          <FieldErrors errors={createVaultErrorsForField(errors, "groupName")} />
        </View>
      </SettingsAccordionSection>

      <SettingsAccordionSection title={t("modal.settings.section.kdf")} defaultOpen>
        <KdfSection
          config={draft.kdf}
          choosesPreset={createVaultChoosesKdf(draft)}
          onChange={(patch) => onChange({ kdf: { ...draft.kdf, ...patch } })}
        />
      </SettingsAccordionSection>
    </View>
  );
}

function CreateVaultAdvancedStep({
  draft,
  errors,
  onChange,
  groups = NO_VAULT_GROUPS,
  vaultRootPath = null,
}: StepProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  const selectedSecurityUi = securityModeToUi(draft.security.mode);
  const securityModes = securityUiModesForStorage(draft.storage.mode);
  const hiddenLocked = draft.groupMode === "existing" && isHiddenGroup(groups, draft.groupId);

  const setStorageMode = (mode: StorageMode) => {
    onChange({
      storage: { mode },
      security: {
        ...draft.security,
        mode: normalizeSecurityModeForStorage(mode, draft.security.mode),
      },
    });
  };

  return (
    <View style={styles.fields}>
      <Text style={typography.bodyMuted}>{t("vault.create.advanced_intro")}</Text>
      <FieldHint>{t("vault.create.settings_editable_later")}</FieldHint>

      <SettingsAccordionSection title={t("modal.settings.section.vault")}>
        <View style={styles.fields}>
          <FieldLabel>{t("modal.settings.field.vault.order")}</FieldLabel>
          <FieldHint>{t("modal.settings.field.vault.order_help")}</FieldHint>
          <ThemedInput
            keyboardType="number-pad"
            value={String(draft.order)}
            onChangeText={(raw) => onChange({ order: Math.max(0, Number.parseInt(raw, 10) || 0) })}
            mono
          />
          <SwitchRow
            label={t("modal.settings.field.vault.hidden")}
            hint={
              hiddenLocked
                ? t("modal.settings.field.vault.hidden_locked_by_group")
                : t("modal.settings.field.vault.hidden_help")
            }
            value={draft.hidden || hiddenLocked}
            disabled={hiddenLocked}
            onValueChange={(hidden) => onChange({ hidden })}
          />
        </View>
      </SettingsAccordionSection>

      <SettingsAccordionSection title={t("modal.settings.section.storage")}>
        <View style={styles.fields}>
          <FieldLabel>{t("modal.settings.field.storage.mode")}</FieldLabel>
          <FieldHint>{t("modal.settings.field.storage.mode_help")}</FieldHint>
          <RadioGroup>
            {(
              [
                ["encrypted_dir", "recommended", "default"],
                ["upriv_plain", "insecure", "insecure"],
              ] as const
            ).map(([mode, badge, tone]) => (
              <PolicyRadioOption
                key={mode}
                value={mode}
                checked={draft.storage.mode === mode}
                disabled={mode === "upriv_plain"}
                title={t(`modal.settings.option.storage.${mode}` as I18nKey)}
                description={t(`modal.settings.option.storage.${mode}_desc` as I18nKey)}
                badge={badge}
                tone={tone}
                onSelect={() => setStorageMode(mode)}
              />
            ))}
          </RadioGroup>
          {draft.storage.mode === "encrypted_dir" ? (
            <FieldHint>{t("warning.encrypted_dir_ram")}</FieldHint>
          ) : null}
          {draft.storage.mode === "upriv_plain" ? (
            <FieldHint>{t("warning.upriv_plain")}</FieldHint>
          ) : null}
          <FieldHint>{t("error.upriv_plain_unavailable")}</FieldHint>
          <FieldErrors errors={createVaultErrorsForField(errors, "storage")} />
        </View>
      </SettingsAccordionSection>

      <SettingsAccordionSection title={t("modal.settings.section.mount")}>
        <VaultSettingsMountSection
          config={draft.mount}
          vaultRootPath={vaultRootPath}
          onChange={(patch) => onChange({ mount: { ...draft.mount, ...patch } })}
        />
        <FieldErrors errors={createVaultErrorsForField(errors, "mount")} />
      </SettingsAccordionSection>

      <SettingsAccordionSection title={t("modal.settings.section.security")}>
        <View style={styles.fields}>
          <SwitchRow
            label={t("modal.settings.field.close.secure_wipe")}
            value={draft.security.secure_wipe_workspace}
            onValueChange={(secure_wipe_workspace) =>
              onChange({ security: { ...draft.security, secure_wipe_workspace } })
            }
          />
          <FieldLabel>{t("modal.settings.field.security.mode")}</FieldLabel>
          <FieldHint>
            {storageModeIsPlaintext(draft.storage.mode)
              ? t("modal.settings.field.security.mode_help_plain")
              : t("modal.settings.field.security.mode_help")}
          </FieldHint>
          <RadioGroup>
            {securityModes.map((uiMode) => {
              const meta = securityOptionMeta(uiMode);
              return (
                <PolicyRadioOption
                  key={uiMode}
                  value={uiMode}
                  checked={selectedSecurityUi === uiMode}
                  title={t(`modal.settings.option.security.${uiMode}` as I18nKey)}
                  description={t(`modal.settings.option.security.${uiMode}_desc` as I18nKey)}
                  badge={meta.badge}
                  tone={meta.tone}
                  onSelect={() =>
                    onChange({ security: { ...draft.security, mode: uiToSecurityMode(uiMode) } })
                  }
                />
              );
            })}
          </RadioGroup>
        </View>
      </SettingsAccordionSection>

      <SettingsAccordionSection title={t("modal.settings.section.policy")}>
        <View style={styles.fields}>
          <FieldLabel>{t("modal.settings.field.policy.external_editors")}</FieldLabel>
          <RadioGroup>
            <PolicyRadioOption
              value="no"
              checked={!draft.policy.allow_external_editors}
              title={t("modal.settings.option.policy.external_editors_no")}
              description={t("modal.settings.option.policy.external_editors_no_desc")}
              badge="recommended"
              onSelect={() =>
                onChange({ policy: { ...draft.policy, allow_external_editors: false } })
              }
            />
            <PolicyRadioOption
              value="yes"
              checked={draft.policy.allow_external_editors}
              title={t("modal.settings.option.policy.external_editors_yes")}
              description={t("modal.settings.option.policy.external_editors_yes_desc")}
              badge="less-secure"
              tone="less-secure"
              onSelect={() =>
                onChange({ policy: { ...draft.policy, allow_external_editors: true } })
              }
            />
          </RadioGroup>
          <FieldLabel>{t("modal.settings.field.policy.copy_outside")}</FieldLabel>
          <RadioGroup>
            <PolicyRadioOption
              value="block"
              checked={draft.policy.disallow_copy_outside_mount}
              title={t("modal.settings.option.policy.copy_block")}
              description={t("modal.settings.option.policy.copy_block_desc")}
              badge="recommended"
              onSelect={() =>
                onChange({ policy: { ...draft.policy, disallow_copy_outside_mount: true } })
              }
            />
            <PolicyRadioOption
              value="allow"
              checked={!draft.policy.disallow_copy_outside_mount}
              title={t("modal.settings.option.policy.copy_allow")}
              description={t("modal.settings.option.policy.copy_allow_desc")}
              badge="less-secure"
              tone="less-secure"
              onSelect={() =>
                onChange({ policy: { ...draft.policy, disallow_copy_outside_mount: false } })
              }
            />
          </RadioGroup>
          <SwitchRow
            label={t("modal.settings.field.close.require_unmount_on_sleep")}
            hint={t("modal.settings.field.close.require_unmount_on_sleep_help")}
            value={draft.policy.require_unmount_on_sleep}
            onValueChange={(require_unmount_on_sleep) =>
              onChange({ policy: { ...draft.policy, require_unmount_on_sleep } })
            }
          />
        </View>
      </SettingsAccordionSection>
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.md },
  multiline: { minHeight: 88, textAlignVertical: "top" },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  fieldErrors: { gap: 2, marginTop: -spacing.sm },
});
