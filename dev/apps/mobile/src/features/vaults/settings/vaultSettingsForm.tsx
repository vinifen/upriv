import { type ReactNode } from "react";
import { Switch, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import {
  COMPRESSION_PRESETS,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  VAULT_NOTE_MAX_LENGTH,
  VAULT_PASSWORD_HINT_MAX_LENGTH,
  compressionPresetFromSevenZip,
  securityModeToUi,
  securityUiModesForStorage,
  sevenZipPatchFromCompressionPreset,
  storageModeCloseOnly,
  storageModeIsPlaintext,
  storageModeSealOnly,
  uiToSecurityMode,
  vaultSettingsSectionsForStorage,
  type CloseDefaultAction,
  type CompressionPreset,
  type SecurityUiMode,
  type StorageMode,
  type VaultGroup,
  type VaultSettingsConfig,
  type VaultSettingsSectionId,
} from "@upriv/shared";
import { useTranslation, type I18nKey } from "@/i18n";
import { useTheme } from "@/theme";
import { radii, spacing } from "@/theme/tokens";
import { Select } from "@/components/ui";
import { PolicyRadioOption, SettingsAccordionSection } from "@/components/settings";

type PatchDraft = <S extends keyof VaultSettingsConfig>(
  section: S,
  patch: Partial<VaultSettingsConfig[S]>,
) => void;

const STORAGE_RADIOS: ReadonlyArray<{
  mode: StorageMode;
  badge?: "recommended" | "more-secure" | "less-secure" | "insecure";
  tone?: "default" | "less-secure" | "insecure";
}> = [
  { mode: "encrypted_dir", badge: "recommended" },
  { mode: "store_only" },
  { mode: "upriv_only", badge: "more-secure" },
  { mode: "upriv_plain", badge: "insecure", tone: "insecure" },
  { mode: "ram_only", badge: "less-secure", tone: "less-secure" },
  { mode: "plain", badge: "insecure", tone: "insecure" },
  { mode: "plain_only", badge: "insecure", tone: "insecure" },
];

const STORAGE_WARNING: Partial<Record<StorageMode, I18nKey>> = {
  encrypted_dir: "warning.encrypted_dir_ram",
  ram_only: "warning.ram_only",
  store_only: "warning.store_only",
  upriv_only: "warning.upriv_only",
  upriv_plain: "warning.upriv_plain",
  plain: "warning.plain_mode",
  plain_only: "warning.plain_only",
};

function securityOptionMeta(uiMode: SecurityUiMode): {
  badge?: "recommended" | "less-secure" | "insecure" | "default";
  tone?: "default" | "less-secure" | "insecure";
} {
  switch (uiMode) {
    case "session_ram":
      return { badge: "recommended" };
    case "prompt_open_close":
      return {};
    case "disk_close":
      return { badge: "less-secure", tone: "less-secure" };
    case "disk_open_close":
      return { badge: "insecure", tone: "insecure" };
    default:
      return {};
  }
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
          backgroundColor: colors.surfaceContainerHighest,
          borderColor: colors.outlineVariant,
          color: colors.onSurface,
        },
        style,
      ]}
      {...rest}
    />
  );
}

function SwitchRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const { colors, typography } = useTheme();
  return (
    <View style={styles.switchRow}>
      <Text style={[typography.body, { flex: 1 }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.outlineVariant, true: colors.accent }}
      />
    </View>
  );
}

function RadioGroup({ children }: { children: ReactNode }) {
  return (
    <View accessibilityRole="radiogroup" style={styles.radioGroup}>
      {children}
    </View>
  );
}

function Warning({ children }: { children: string }) {
  const { colors, typography } = useTheme();
  return <Text style={[typography.caption, { color: colors.onErrorContainer }]}>{children}</Text>;
}

interface VaultSettingsFormProps {
  draft: VaultSettingsConfig;
  patchDraft: PatchDraft;
  storageModeLocked?: boolean;
  groups?: readonly VaultGroup[];
  selectedGroupId?: string;
  newGroupName?: string;
  nameError?: string | null;
  onSelectedGroupIdChange?: (groupId: string) => void;
  onNewGroupNameChange?: (name: string) => void;
}

export function VaultSettingsForm({
  draft,
  patchDraft,
  storageModeLocked = false,
  groups = [],
  selectedGroupId = "",
  newGroupName = "",
  nameError = null,
  onSelectedGroupIdChange,
  onNewGroupNameChange,
}: VaultSettingsFormProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.root}>
      {vaultSettingsSectionsForStorage(draft.storage.mode).map((sectionId) => (
        <SettingsAccordionSection
          key={sectionId}
          title={t(`modal.settings.section.${sectionId}` as I18nKey)}
          defaultOpen={sectionId === "vault"}
        >
          {renderSection(sectionId, draft, patchDraft, storageModeLocked)}
        </SettingsAccordionSection>
      ))}
      {onSelectedGroupIdChange && onNewGroupNameChange ? (
        <SettingsAccordionSection title={t("vault.group.assignment.section")}>
          <GroupSection
            groups={groups}
            selectedGroupId={selectedGroupId}
            newGroupName={newGroupName}
            nameError={nameError}
            onSelectedGroupIdChange={onSelectedGroupIdChange}
            onNewGroupNameChange={onNewGroupNameChange}
          />
        </SettingsAccordionSection>
      ) : null}
    </View>
  );
}

function renderSection(
  sectionId: VaultSettingsSectionId,
  draft: VaultSettingsConfig,
  patchDraft: PatchDraft,
  storageModeLocked: boolean,
) {
  switch (sectionId) {
    case "vault":
      return (
        <VaultSection config={draft.vault} onChange={(patch) => patchDraft("vault", patch)} />
      );
    case "storage":
      return (
        <StorageSection
          config={draft.storage}
          locked={storageModeLocked}
          onChange={(patch) => patchDraft("storage", patch)}
        />
      );
    case "close":
      return (
        <CloseSection
          storageMode={draft.storage.mode}
          close={draft.close}
          autoClose={draft.auto_close}
          secureWipe={draft.security.secure_wipe_workspace}
          requireUnmountOnSleep={draft.policy.require_unmount_on_sleep}
          onCloseChange={(patch) => patchDraft("close", patch)}
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
          onChange={(patch) => patchDraft("security", patch)}
          onPasswordHintChange={(password_hint) => patchDraft("vault", { password_hint })}
        />
      );
    case "seven_zip":
      return (
        <SevenZipSection
          config={draft.seven_zip}
          onChange={(patch) => patchDraft("seven_zip", patch)}
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
}: {
  config: VaultSettingsConfig["vault"];
  onChange: (patch: Partial<VaultSettingsConfig["vault"]>) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.fields}>
      <FieldLabel>{t("modal.settings.field.vault.display_name")}</FieldLabel>
      <ThemedInput
        value={config.display_name}
        maxLength={VAULT_DISPLAY_NAME_MAX_LENGTH}
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
        value={config.hidden}
        onValueChange={(hidden) => onChange({ hidden })}
      />
      <FieldHint>{t("modal.settings.field.vault.hidden_help")}</FieldHint>
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
      {locked ? <FieldHint>{t("modal.settings.field.storage.mode_locked")}</FieldHint> : null}
      <RadioGroup>
        {STORAGE_RADIOS.map(({ mode, badge, tone }) => (
          <PolicyRadioOption
            key={mode}
            value={mode}
            checked={config.mode === mode}
            disabled={locked}
            title={t(`modal.settings.option.storage.${mode}` as I18nKey)}
            description={t(`modal.settings.option.storage.${mode}_desc` as I18nKey)}
            badge={badge}
            tone={tone}
            onSelect={() => onChange({ mode })}
          />
        ))}
      </RadioGroup>
      {warning ? <Warning>{t(warning)}</Warning> : null}
    </View>
  );
}

function CloseSection({
  storageMode,
  close,
  autoClose,
  secureWipe,
  requireUnmountOnSleep,
  onCloseChange,
  onAutoCloseChange,
  onSecureWipeChange,
  onRequireUnmountOnSleepChange,
}: {
  storageMode: StorageMode;
  close: VaultSettingsConfig["close"];
  autoClose: VaultSettingsConfig["auto_close"];
  secureWipe: boolean;
  requireUnmountOnSleep: boolean;
  onCloseChange: (patch: Partial<VaultSettingsConfig["close"]>) => void;
  onAutoCloseChange: (patch: Partial<VaultSettingsConfig["auto_close"]>) => void;
  onSecureWipeChange: (secureWipe: boolean) => void;
  onRequireUnmountOnSleepChange: (requireUnmountOnSleep: boolean) => void;
}) {
  const { t } = useTranslation();
  const storeOnly = storageMode === "store_only";

  return (
    <View style={styles.fields}>
      {storageModeSealOnly(storageMode) ? (
        <FieldHint>
          {t(
            (storageMode === "ram_only"
              ? "modal.settings.field.close.ram_seal_only"
              : storageMode === "plain_only"
                ? "modal.settings.field.close.plain_only_seal_only"
                : "modal.settings.field.close.plain_seal_only") as I18nKey,
          )}
        </FieldHint>
      ) : storageModeCloseOnly(storageMode) ? (
        <FieldHint>
          {t(
            (storageMode === "upriv_plain"
              ? "modal.settings.field.close.upriv_plain_close_only"
              : "modal.settings.field.close.upriv_only_close_only") as I18nKey,
          )}
        </FieldHint>
      ) : (
        <>
          <FieldLabel>{t("modal.settings.field.close.default_action")}</FieldLabel>
          <FieldHint>
            {t(
              (storeOnly
                ? "modal.settings.field.close.default_action_help_store_only"
                : "modal.settings.field.close.default_action_help") as I18nKey,
            )}
          </FieldHint>
          <RadioGroup>
            <PolicyRadioOption
              value="close"
              checked={close.default_action === "close"}
              title={t(
                (storeOnly
                  ? "modal.settings.option.close.close_store_only"
                  : "modal.settings.option.close.close") as I18nKey,
              )}
              description={t(
                (storeOnly
                  ? "modal.settings.option.close.close_store_only_desc"
                  : "modal.settings.option.close.close_desc") as I18nKey,
              )}
              badge="recommended"
              onSelect={() => onCloseChange({ default_action: "close" as CloseDefaultAction })}
            />
            <PolicyRadioOption
              value="seal"
              checked={close.default_action === "seal"}
              title={t("modal.settings.option.close.seal")}
              description={t(
                (storeOnly
                  ? "modal.settings.option.close.seal_store_only_desc"
                  : "modal.settings.option.close.seal_desc") as I18nKey,
              )}
              onSelect={() => onCloseChange({ default_action: "seal" })}
            />
          </RadioGroup>
        </>
      )}

      <SwitchRow
        label={t("modal.settings.field.close.secure_wipe")}
        value={secureWipe}
        onValueChange={onSecureWipeChange}
      />
      {!secureWipe ? <Warning>{t("modal.settings.field.close.secure_wipe_warn")}</Warning> : null}

      <SwitchRow
        label={t("modal.settings.field.auto_close.enabled")}
        value={autoClose.enabled}
        onValueChange={(enabled) => onAutoCloseChange({ enabled })}
      />
      {storageModeSealOnly(storageMode) && autoClose.enabled ? (
        <FieldHint>{t("modal.settings.field.auto_close.plain_seals")}</FieldHint>
      ) : null}
      {autoClose.enabled ? (
        <>
          <FieldLabel>{t("modal.settings.field.auto_close.idle_minutes")}</FieldLabel>
          <ThemedInput
            keyboardType="number-pad"
            value={String(autoClose.idle_minutes)}
            onChangeText={(raw) =>
              onAutoCloseChange({
                idle_minutes: Math.min(1440, Math.max(1, Number.parseInt(raw, 10) || 1)),
              })
            }
            mono
          />
          <FieldLabel>{t("modal.settings.field.auto_close.warn_before_seconds")}</FieldLabel>
          <ThemedInput
            keyboardType="number-pad"
            value={String(autoClose.warn_before_seconds)}
            onChangeText={(raw) =>
              onAutoCloseChange({
                warn_before_seconds: Math.min(300, Math.max(0, Number.parseInt(raw, 10) || 0)),
              })
            }
            mono
          />
        </>
      ) : null}

      <SwitchRow
        label={t("modal.settings.field.close.require_unmount_on_sleep")}
        value={requireUnmountOnSleep}
        onValueChange={onRequireUnmountOnSleepChange}
      />
      <FieldHint>{t("modal.settings.field.close.require_unmount_on_sleep_help")}</FieldHint>
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
      {config.enabled ? (
        <>
          <Select
            label={t("modal.settings.field.backup.mode")}
            value={config.mode}
            options={[
              { value: "keep_last", label: t("modal.settings.option.backup.keep_last") },
              { value: "keep_all", label: t("modal.settings.option.backup.keep_all") },
            ]}
            onChange={(mode) => onChange({ mode })}
          />
          {config.mode === "keep_last" ? (
            <>
              <FieldLabel>{t("modal.settings.field.backup.keep_last")}</FieldLabel>
              <ThemedInput
                keyboardType="number-pad"
                value={String(config.keep_last)}
                onChangeText={(raw) =>
                  onChange({ keep_last: Math.min(99, Math.max(1, Number.parseInt(raw, 10) || 1)) })
                }
                mono
              />
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function SecuritySection({
  storageMode,
  config,
  passwordHint,
  onChange,
  onPasswordHintChange,
}: {
  storageMode: StorageMode;
  config: VaultSettingsConfig["security"];
  passwordHint: string;
  onChange: (patch: Partial<VaultSettingsConfig["security"]>) => void;
  onPasswordHintChange: (passwordHint: string) => void;
}) {
  const { t } = useTranslation();
  const selectedUi = securityModeToUi(config.mode);
  const modes = securityUiModesForStorage(storageMode);
  return (
    <View style={styles.fields}>
      <FieldLabel>{t("modal.settings.field.security.mode")}</FieldLabel>
      <FieldHint>
        {storageModeIsPlaintext(storageMode)
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
              title={t(`modal.settings.option.security.${uiMode}` as I18nKey)}
              description={t(`modal.settings.option.security.${uiMode}_desc` as I18nKey)}
              badge={meta.badge}
              tone={meta.tone}
              onSelect={() => onChange({ mode: uiToSecurityMode(uiMode) })}
            />
          );
        })}
      </RadioGroup>
      <FieldLabel>{t("unlock.password_hint_label")}</FieldLabel>
      <ThemedInput
        value={passwordHint}
        maxLength={VAULT_PASSWORD_HINT_MAX_LENGTH}
        onChangeText={onPasswordHintChange}
      />
    </View>
  );
}

function SevenZipSection({
  config,
  onChange,
}: {
  config: VaultSettingsConfig["seven_zip"];
  onChange: (patch: Partial<VaultSettingsConfig["seven_zip"]>) => void;
}) {
  const { t } = useTranslation();
  const preset = compressionPresetFromSevenZip(config);
  return (
    <View style={styles.fields}>
      <FieldHint>{t("modal.settings.section.seven_zip_intro")}</FieldHint>
      <FieldLabel>{t("modal.settings.field.seven_zip.compression")}</FieldLabel>
      <FieldHint>{t("modal.settings.field.seven_zip.compression_help")}</FieldHint>
      <RadioGroup>
        {COMPRESSION_PRESETS.map((value) => (
          <PolicyRadioOption
            key={value}
            value={value}
            checked={preset === value}
            title={t(`modal.settings.option.seven_zip.compression.${value}` as I18nKey)}
            description={t(
              `modal.settings.option.seven_zip.compression.${value}_desc` as I18nKey,
            )}
            badge={value === "none" ? "recommended" : undefined}
            onSelect={() => onChange(sevenZipPatchFromCompressionPreset(value as CompressionPreset))}
          />
        ))}
      </RadioGroup>
      <SwitchRow
        label={t("modal.settings.field.seven_zip.encrypt_file_names_label")}
        value={config.encrypt_file_names}
        onValueChange={(encrypt_file_names) => onChange({ encrypt_file_names })}
      />
      {!config.encrypt_file_names ? (
        <Warning>{t("modal.settings.field.seven_zip.encrypt_file_names_off_warn")}</Warning>
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
      {config.allow_external_editors ? <Warning>{t("warning.external_editor")}</Warning> : null}
      {externalBlockCopy ? (
        <FieldHint>{t("warning.policy.external_block_copy")}</FieldHint>
      ) : null}
    </View>
  );
}

function GroupSection({
  groups,
  selectedGroupId,
  newGroupName,
  nameError,
  onSelectedGroupIdChange,
  onNewGroupNameChange,
}: {
  groups: readonly VaultGroup[];
  selectedGroupId: string;
  newGroupName: string;
  nameError: string | null;
  onSelectedGroupIdChange: (groupId: string) => void;
  onNewGroupNameChange: (name: string) => void;
}) {
  const { t } = useTranslation();
  const creating = Boolean(newGroupName.trim());
  const groupOptions = [
    { value: "", label: t("vault.group.assignment.ungrouped") },
    ...groups.map((group) => ({ value: group.id, label: group.displayName })),
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
  root: { gap: spacing.sm, paddingBottom: spacing.sm },
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
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
});
