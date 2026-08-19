import { useRef, useState } from "react";
import {
  Pressable,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import {
  COMPRESSION_PRESETS,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  VAULT_NOTE_MAX_LENGTH,
  VAULT_PASSWORD_HINT_MAX_LENGTH,
  compressionPresetFromSevenZip,
  createVaultErrorI18nKey,
  displayNameFromArchiveFilename,
  normalizeSecurityModeForStorage,
  securityModeToUi,
  securityUiModesForStorage,
  sevenZipPatchFromCompressionPreset,
  storageModeCanSeal,
  storageModeCloseOnly,
  storageModeHasPortableArchive,
  storageModeIsPlaintext,
  storageModeSealOnly,
  transitionStorageModeClose,
  uiToSecurityMode,
  type CloseDefaultAction,
  type CompressionPreset,
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
import { radii, spacing } from "@/theme/tokens";
import { Button, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import { PolicyRadioOption } from "@/components/settings";

interface StepProps {
  draft: CreateVaultDraft;
  errors: CreateVaultValidationCode[];
  onChange: (patch: Partial<CreateVaultDraft>) => void;
  groups?: readonly VaultGroup[];
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

function StepErrors({ errors }: { errors: CreateVaultValidationCode[] }) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  if (errors.length === 0) return null;
  return (
    <View style={[styles.errorBox, { backgroundColor: colors.errorContainer + "33" }]}>
      {errors.map((code) => (
        <Text key={code} style={[typography.body, { color: colors.onErrorContainer }]}>
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

function FieldLabel({ children }: { children: string }) {
  const { typography } = useTheme();
  return <Text style={typography.bodyMuted}>{children}</Text>;
}

function FieldHint({ children }: { children: string }) {
  const { typography } = useTheme();
  return <Text style={typography.caption}>{children}</Text>;
}

function ThemedInput({ mono, style, ...rest }: TextInputProps & { mono?: boolean }) {
  const { colors, typography } = useTheme();
  return (
    <TextInput
      placeholderTextColor={colors.onSurfaceVariant}
      style={[
        mono ? typography.mono : typography.body,
        styles.input,
        {
          backgroundColor: colors.surfaceContainer,
          borderColor: colors.outlineVariant,
          color: colors.onSurface,
        },
        style,
      ]}
      {...rest}
    />
  );
}

function PasswordField({
  value,
  onChangeText,
  autoFocus,
}: {
  value: string;
  onChangeText: (v: string) => void;
  autoFocus?: boolean;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.passwordWrap}>
      <ThemedInput
        value={value}
        secureTextEntry={!visible}
        autoComplete="password-new"
        onChangeText={onChangeText}
        autoFocus={autoFocus}
        style={styles.passwordInput}
      />
      <Pressable
        onPress={() => setVisible((v) => !v)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={visible ? t("action.hide_password") : t("action.show_password")}
        style={styles.eyeBtn}
      >
        <Icon name={visible ? "eye-off" : "eye"} size={20} color={colors.onSurfaceVariant} />
      </Pressable>
    </View>
  );
}

function securityOptionMeta(uiMode: SecurityUiMode): {
  badge?: "recommended" | "less-secure" | "insecure" | "default";
  tone?: "default" | "less-secure" | "insecure";
} {
  if (uiMode === "session_ram") return { badge: "recommended" };
  if (uiMode === "disk_open_close") return { badge: "less-secure", tone: "less-secure" };
  if (uiMode === "disk_close") return { badge: "less-secure", tone: "less-secure" };
  return {};
}

function CreateVaultSourceStep({ draft, errors, onChange }: StepProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  const createVaultService = useCreateVaultService();

  const chooseArchive = () => {
    const { fileName, path } = createVaultService.selectImportArchiveForProbe();
    onChange({
      source: "import",
      importFileName: fileName,
      importFilePath: path,
      displayName: displayNameFromArchiveFilename(fileName),
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
        label={t("vault.create.action.choose_archive")}
        variant="ghost"
        onPress={chooseArchive}
      />
    </View>
  );

  return (
    <View style={styles.fields}>
      <Text style={typography.bodyMuted}>{t("vault.create.source_intro")}</Text>
      <View accessibilityRole="radiogroup" style={styles.radioGroup}>
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
      </View>
      <StepErrors errors={errors} />
    </View>
  );
}

function CreateVaultIdentityStep({ draft, errors, onChange }: StepProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  return (
    <View style={styles.fields}>
      <Text style={typography.bodyMuted}>{t("vault.create.identity_intro")}</Text>
      <FieldLabel>{t("vault.name.label")}</FieldLabel>
      <ThemedInput
        value={draft.displayName}
        maxLength={VAULT_DISPLAY_NAME_MAX_LENGTH}
        onChangeText={(displayName) => onChange({ displayName })}
        autoFocus
      />
      <FieldLabel>{t("vault.create.note")}</FieldLabel>
      <FieldHint>{t("vault.create.note_help", { max: String(VAULT_NOTE_MAX_LENGTH) })}</FieldHint>
      <ThemedInput
        value={draft.note}
        maxLength={VAULT_NOTE_MAX_LENGTH}
        onChangeText={(note) => onChange({ note })}
        multiline
        style={styles.multiline}
      />
      <StepErrors errors={errors} />
    </View>
  );
}

function CreateVaultPasswordStep({
  draft,
  errors,
  onChange,
  onTestImportPassword,
  testingPassword = false,
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
      <PasswordField
        value={draft.password}
        autoFocus
        onChangeText={(password) =>
          onChange({
            password,
            passwordValidated: false,
            passwordTestFailed: false,
          })
        }
      />
      {!isImport ? (
        <>
          <FieldLabel>{t("vault.create.password_confirm")}</FieldLabel>
          <PasswordField
            value={draft.passwordConfirm}
            onChangeText={(passwordConfirm) => onChange({ passwordConfirm })}
          />
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
        value={draft.passwordHint}
        maxLength={VAULT_PASSWORD_HINT_MAX_LENGTH}
        onChangeText={(passwordHint) => onChange({ passwordHint })}
      />
      <StepErrors errors={errors} />
    </View>
  );
}

function CreateVaultGeneralStep({ draft, errors, onChange, groups = [] }: StepProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const preset = compressionPresetFromSevenZip(draft.seven_zip);
  const creatingGroup = Boolean(draft.groupName.trim());
  const groupErrors = errors.filter((code) => code.startsWith("group_"));
  const groupSelectValue = draft.groupMode === "existing" ? draft.groupId : "";
  const groupOptions = [
    { value: "", label: t("vault.group.assignment.ungrouped") },
    ...groups.map((group) => ({ value: group.id, label: group.displayName })),
  ];

  return (
    <View style={styles.fields}>
      <Text style={typography.bodyMuted}>{t("vault.create.general_intro")}</Text>

      <View style={styles.switchRow}>
        <Text style={[typography.body, { flex: 1 }]}>
          {t("modal.settings.field.auto_close.enabled")}
        </Text>
        <Switch
          value={draft.auto_close.enabled}
          onValueChange={(enabled) => onChange({ auto_close: { ...draft.auto_close, enabled } })}
          trackColor={{ false: colors.outlineVariant, true: colors.accent }}
        />
      </View>
      {storageModeSealOnly(draft.storage.mode) && draft.auto_close.enabled ? (
        <FieldHint>{t("modal.settings.field.auto_close.plain_seals")}</FieldHint>
      ) : null}
      {draft.auto_close.enabled ? (
        <>
          <FieldLabel>{t("modal.settings.field.auto_close.idle_minutes")}</FieldLabel>
          <ThemedInput
            keyboardType="number-pad"
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
          <FieldLabel>{t("modal.settings.field.auto_close.warn_before_seconds")}</FieldLabel>
          <ThemedInput
            keyboardType="number-pad"
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
        </>
      ) : null}

      {storageModeHasPortableArchive(draft.storage.mode) ? (
        <>
          <View style={styles.switchRow}>
            <Text style={[typography.body, { flex: 1 }]}>
              {t("modal.settings.field.backup.enabled")}
            </Text>
            <Switch
              value={draft.backup.enabled}
              onValueChange={(enabled) => onChange({ backup: { ...draft.backup, enabled } })}
              trackColor={{ false: colors.outlineVariant, true: colors.accent }}
            />
          </View>
          {draft.backup.enabled ? (
            <>
              <Select
                label={t("modal.settings.field.backup.mode")}
                value={draft.backup.mode}
                options={[
                  { value: "keep_last", label: t("modal.settings.option.backup.keep_last") },
                  { value: "keep_all", label: t("modal.settings.option.backup.keep_all") },
                ]}
                onChange={(mode) => onChange({ backup: { ...draft.backup, mode } })}
              />
              {draft.backup.mode === "keep_last" ? (
                <>
                  <FieldLabel>{t("modal.settings.field.backup.keep_last")}</FieldLabel>
                  <ThemedInput
                    keyboardType="number-pad"
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
                </>
              ) : null}
            </>
          ) : null}

          <FieldLabel>{t("modal.settings.field.seven_zip.compression")}</FieldLabel>
          <FieldHint>{t("modal.settings.field.seven_zip.compression_help")}</FieldHint>
          <View accessibilityRole="radiogroup" style={styles.radioGroup}>
            {COMPRESSION_PRESETS.map((value) => (
              <PolicyRadioOption
                key={value}
                value={value}
                checked={preset === value}
                title={t(`modal.settings.option.seven_zip.compression.${value}` as I18nKey)}
                description={t(
                  `modal.settings.option.seven_zip.compression.${value}_desc` as I18nKey,
                )}
                badge={value === "none" ? "default" : undefined}
                onSelect={() =>
                  onChange({
                    seven_zip: {
                      ...draft.seven_zip,
                      ...sevenZipPatchFromCompressionPreset(value as CompressionPreset),
                    },
                  })
                }
              />
            ))}
          </View>
        </>
      ) : null}

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
          onChange({ groupMode: "existing", groupId: nextId, groupName: "" });
        }}
      />
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
      <StepErrors errors={groupErrors} />
    </View>
  );
}

function CreateVaultAdvancedStep({ draft, onChange }: StepProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const encryptedCloseRef = useRef<CloseDefaultAction>(draft.close.default_action);
  const selectedSecurityUi = securityModeToUi(draft.security.mode);
  const securityModes = securityUiModesForStorage(draft.storage.mode);

  const setStorageMode = (mode: StorageMode) => {
    const { close, encryptedClosePreference } = transitionStorageModeClose(
      draft.storage.mode,
      draft.close.default_action,
      mode,
      encryptedCloseRef.current,
    );
    encryptedCloseRef.current = encryptedClosePreference;
    onChange({
      storage: { mode },
      close: { default_action: close },
      security: {
        ...draft.security,
        mode: normalizeSecurityModeForStorage(mode, draft.security.mode),
      },
      ...(storageModeCloseOnly(mode) ? { backup: { ...draft.backup, enabled: false } } : {}),
    });
  };

  const setCloseDefault = (defaultAction: CloseDefaultAction) => {
    if (storageModeCanSeal(draft.storage.mode)) {
      encryptedCloseRef.current = defaultAction;
    }
    onChange({ close: { default_action: defaultAction } });
  };

  return (
    <View style={styles.fields}>
      <Text style={typography.bodyMuted}>{t("vault.create.advanced_intro")}</Text>
      <FieldHint>{t("vault.create.settings_editable_later")}</FieldHint>

      <FieldLabel>{t("modal.settings.field.vault.order")}</FieldLabel>
      <FieldHint>{t("modal.settings.field.vault.order_help")}</FieldHint>
      <ThemedInput
        keyboardType="number-pad"
        value={String(draft.order)}
        onChangeText={(raw) => onChange({ order: Math.max(0, Number.parseInt(raw, 10) || 0) })}
        mono
      />

      <View style={styles.switchRow}>
        <Text style={[typography.body, { flex: 1 }]}>{t("modal.settings.field.vault.hidden")}</Text>
        <Switch
          value={draft.hidden}
          onValueChange={(hidden) => onChange({ hidden })}
          trackColor={{ false: colors.outlineVariant, true: colors.accent }}
        />
      </View>
      <FieldHint>{t("modal.settings.field.vault.hidden_help")}</FieldHint>

      <FieldLabel>{t("modal.settings.field.storage.mode")}</FieldLabel>
      <FieldHint>{t("modal.settings.field.storage.mode_help")}</FieldHint>
      <View accessibilityRole="radiogroup" style={styles.radioGroup}>
        {(
          [
            ["encrypted_dir", "recommended", "default"],
            ["store_only", undefined, "default"],
            ["upriv_only", "more-secure", "default"],
            ["upriv_plain", "insecure", "insecure"],
            ["ram_only", "less-secure", "less-secure"],
            ["plain", "insecure", "insecure"],
            ["plain_only", "insecure", "insecure"],
          ] as const
        ).map(([mode, badge, tone]) => (
          <PolicyRadioOption
            key={mode}
            value={mode}
            checked={draft.storage.mode === mode}
            title={t(`modal.settings.option.storage.${mode}` as I18nKey)}
            description={t(`modal.settings.option.storage.${mode}_desc` as I18nKey)}
            badge={badge}
            tone={tone}
            onSelect={() => setStorageMode(mode)}
          />
        ))}
      </View>
      {draft.storage.mode === "encrypted_dir" ? (
        <Text style={[typography.caption, { color: colors.onErrorContainer }]}>
          {t("warning.encrypted_dir_ram")}
        </Text>
      ) : null}
      {draft.storage.mode === "ram_only" ? (
        <Text style={[typography.caption, { color: colors.onErrorContainer }]}>
          {t("warning.ram_only")}
        </Text>
      ) : null}
      {draft.storage.mode === "store_only" ? (
        <Text style={[typography.caption, { color: colors.onErrorContainer }]}>
          {t("warning.store_only")}
        </Text>
      ) : null}
      {draft.storage.mode === "upriv_only" ? (
        <Text style={[typography.caption, { color: colors.onErrorContainer }]}>
          {t("warning.upriv_only")}
        </Text>
      ) : null}
      {draft.storage.mode === "upriv_plain" ? (
        <Text style={[typography.caption, { color: colors.onErrorContainer }]}>
          {t("warning.upriv_plain")}
        </Text>
      ) : null}
      {draft.storage.mode === "plain" ? (
        <Text style={[typography.caption, { color: colors.onErrorContainer }]}>
          {t("warning.plain_mode")}
        </Text>
      ) : null}
      {draft.storage.mode === "plain_only" ? (
        <Text style={[typography.caption, { color: colors.onErrorContainer }]}>
          {t("warning.plain_only")}
        </Text>
      ) : null}

      {storageModeSealOnly(draft.storage.mode) ? (
        <FieldHint>
          {t(
            (draft.storage.mode === "ram_only"
              ? "modal.settings.field.close.ram_seal_only"
              : draft.storage.mode === "plain_only"
                ? "modal.settings.field.close.plain_only_seal_only"
                : "modal.settings.field.close.plain_seal_only") as I18nKey,
          )}
        </FieldHint>
      ) : storageModeCloseOnly(draft.storage.mode) ? (
        <FieldHint>
          {t(
            (draft.storage.mode === "upriv_plain"
              ? "modal.settings.field.close.upriv_plain_close_only"
              : "modal.settings.field.close.upriv_only_close_only") as I18nKey,
          )}
        </FieldHint>
      ) : (
        <>
          <FieldLabel>{t("modal.settings.field.close.default_action")}</FieldLabel>
          <View accessibilityRole="radiogroup" style={styles.radioGroup}>
            <PolicyRadioOption
              value="close"
              checked={draft.close.default_action === "close"}
              title={t(
                (draft.storage.mode === "store_only"
                  ? "modal.settings.option.close.close_store_only"
                  : "modal.settings.option.close.close") as I18nKey,
              )}
              description={t(
                (draft.storage.mode === "store_only"
                  ? "modal.settings.option.close.close_store_only_desc"
                  : "modal.settings.option.close.close_desc") as I18nKey,
              )}
              badge="recommended"
              onSelect={() => setCloseDefault("close")}
            />
            <PolicyRadioOption
              value="seal"
              checked={draft.close.default_action === "seal"}
              title={t("modal.settings.option.close.seal")}
              description={t(
                (draft.storage.mode === "store_only"
                  ? "modal.settings.option.close.seal_store_only_desc"
                  : "modal.settings.option.close.seal_desc") as I18nKey,
              )}
              onSelect={() => setCloseDefault("seal")}
            />
          </View>
        </>
      )}

      <View style={styles.switchRow}>
        <Text style={[typography.body, { flex: 1 }]}>
          {t("modal.settings.field.close.secure_wipe")}
        </Text>
        <Switch
          value={draft.security.secure_wipe_workspace}
          onValueChange={(secure_wipe_workspace) =>
            onChange({ security: { ...draft.security, secure_wipe_workspace } })
          }
          trackColor={{ false: colors.outlineVariant, true: colors.accent }}
        />
      </View>

      <FieldLabel>{t("modal.settings.field.security.mode")}</FieldLabel>
      <FieldHint>
        {storageModeIsPlaintext(draft.storage.mode)
          ? t("modal.settings.field.security.mode_help_plain")
          : t("modal.settings.field.security.mode_help")}
      </FieldHint>
      <View accessibilityRole="radiogroup" style={styles.radioGroup}>
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
      </View>

      <FieldLabel>{t("modal.settings.field.policy.external_editors")}</FieldLabel>
      <View accessibilityRole="radiogroup" style={styles.radioGroup}>
        <PolicyRadioOption
          value="no"
          checked={!draft.policy.allow_external_editors}
          title={t("modal.settings.option.policy.external_editors_no")}
          description={t("modal.settings.option.policy.external_editors_no_desc")}
          badge="recommended"
          onSelect={() => onChange({ policy: { ...draft.policy, allow_external_editors: false } })}
        />
        <PolicyRadioOption
          value="yes"
          checked={draft.policy.allow_external_editors}
          title={t("modal.settings.option.policy.external_editors_yes")}
          description={t("modal.settings.option.policy.external_editors_yes_desc")}
          badge="less-secure"
          tone="less-secure"
          onSelect={() => onChange({ policy: { ...draft.policy, allow_external_editors: true } })}
        />
      </View>

      <FieldLabel>{t("modal.settings.field.policy.copy_outside")}</FieldLabel>
      <View accessibilityRole="radiogroup" style={styles.radioGroup}>
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
      </View>

      {storageModeHasPortableArchive(draft.storage.mode) ? (
        <>
          <View style={styles.switchRow}>
            <Text style={[typography.body, { flex: 1 }]}>
              {t("modal.settings.field.seven_zip.encrypt_file_names_label")}
            </Text>
            <Switch
              value={draft.seven_zip.encrypt_file_names}
              onValueChange={(encrypt_file_names) =>
                onChange({ seven_zip: { ...draft.seven_zip, encrypt_file_names } })
              }
              trackColor={{ false: colors.outlineVariant, true: colors.accent }}
            />
          </View>
          {!draft.seven_zip.encrypt_file_names ? (
            <Text style={[typography.caption, { color: colors.onErrorContainer }]}>
              {t("modal.settings.field.seven_zip.encrypt_file_names_off_warn")}
            </Text>
          ) : null}
        </>
      ) : null}

      <View style={styles.switchRow}>
        <Text style={[typography.body, { flex: 1 }]}>
          {t("modal.settings.field.close.require_unmount_on_sleep")}
        </Text>
        <Switch
          value={draft.policy.require_unmount_on_sleep}
          onValueChange={(require_unmount_on_sleep) =>
            onChange({ policy: { ...draft.policy, require_unmount_on_sleep } })
          }
          trackColor={{ false: colors.outlineVariant, true: colors.accent }}
        />
      </View>
      <FieldHint>{t("modal.settings.field.close.require_unmount_on_sleep_help")}</FieldHint>
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.md },
  radioGroup: { gap: spacing.sm },
  input: {
    borderRadius: radii.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 44,
  },
  multiline: { minHeight: 88, textAlignVertical: "top" },
  passwordWrap: { position: "relative", justifyContent: "center" },
  passwordInput: { paddingRight: 48 },
  eyeBtn: {
    position: "absolute",
    right: spacing.sm,
    height: 44,
    width: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  errorBox: {
    borderRadius: radii.sm,
    padding: spacing.md,
    gap: spacing.xs,
  },
});
