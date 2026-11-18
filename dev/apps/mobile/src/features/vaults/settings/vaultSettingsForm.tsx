import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import {
  AUTO_CLOSE_WHEN_BUSY,
  KDF_UNLOCK_OPTION_META,
  KDF_UNLOCK_PRESETS,
  IDLE_AUTO_CLOSE_MINUTES_MAX,
  IDLE_AUTO_CLOSE_MINUTES_MIN,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  VAULT_NOTE_MAX_LENGTH,
  VAULT_PASSWORD_HINT_MAX_LENGTH,
  VAULT_SETTINGS_SECTIONS,
  type AppSettingsConfig,
  type DeviceGroups,
  type HereDevice,
  type VaultBackupChoice,
  type VaultUnlockedChoice,
  type KdfUnlockPreset,
  type PolicyRadioBadge,
  type StorageMode,
  type VaultConfigEditHold,
  type VaultGroup,
  type VaultSettingsConfig,
  type VaultSettingsSectionId,
  groupsForAssignmentPicker,
  groupAssignmentClearOption,
  requireVaultConfigEditLockedI18nKey,
} from "@upriv/shared";
import { LongTextInput } from "@/components/LongTextInput";
import { useTranslation, type I18nKey } from "@/i18n";
import { spacing } from "@/theme/tokens";
import { Select } from "@/components/ui";
import {
  IntegerInput,
  PolicyRadioOption,
  SettingsAccordionSection,
  VaultBackupFolderField,
  VaultUnlockedFolderSection,
} from "@/components/settings";
import {
  FieldHint,
  FieldLabel,
  RadioGroup,
  SwitchRow,
  ThemedInput,
  DisplayNameFieldError,
} from "@/components/settings/settingsFields";

type PatchDraft = <S extends keyof VaultSettingsConfig>(
  section: S,
  patch: Partial<VaultSettingsConfig[S]>,
) => void;

const STORAGE_RADIOS: ReadonlyArray<{
  mode: StorageMode;
  badge?: PolicyRadioBadge;
  tone?: "default" | "less-secure";
}> = [
  { mode: "encrypted_dir", badge: "recommended" },
  { mode: "upriv_plain", badge: "not-recommended", tone: "less-secure" },
];

const STORAGE_WARNING: Partial<Record<StorageMode, I18nKey>> = {
  encrypted_dir: "warning.encrypted_dir_ram",
  upriv_plain: "warning.upriv_plain",
};

interface VaultSettingsFormProps {
  draft: VaultSettingsConfig;
  patchDraft: PatchDraft;
  displayNameLocked?: boolean;
  /** Why this device's unlocked folder group cannot change now; `null` when it can. */
  unlockedLockedHint?: string | null;
  /** Work beside the vault's status that locks fields (`vaultConfigEditHold`). */
  editHold?: VaultConfigEditHold;
  /** What the folder lists need: the app's lists, the vault's as loaded, this device. */
  lists: VaultListsContext;
  hiddenLocked?: boolean;
}

/** What a vault's folder lists show beside its draft. */
export interface VaultListsContext {
  app: Pick<AppSettingsConfig, "unlocked_folders" | "backups">;
  /** The vault's lists as loaded, empty for a vault being created: a save sends the change from here. */
  saved: {
    unlocked: DeviceGroups<VaultUnlockedChoice>;
    backups: DeviceGroups<VaultBackupChoice>;
  };
  here: HereDevice | null;
  /** `null` while the vault is being created. */
  vaultId: string | null;
}

export function VaultSettingsForm({
  draft,
  patchDraft,
  displayNameLocked = false,
  unlockedLockedHint = null,
  editHold = {},
  lists,
  hiddenLocked = false,
}: VaultSettingsFormProps) {
  const { t } = useTranslation();
  const locks = {
    displayNameLocked,
    unlockedLockedHint,
    hiddenLocked,
    editHold,
  };

  return (
    <View style={styles.root}>
      {VAULT_SETTINGS_SECTIONS.map((sectionId) => (
        <SettingsAccordionSection
          key={sectionId}
          title={t(`modal.settings.section.${sectionId}` as I18nKey)}
        >
          {renderSection(sectionId, draft, patchDraft, locks, lists)}
        </SettingsAccordionSection>
      ))}
    </View>
  );
}

function renderSection(
  sectionId: VaultSettingsSectionId,
  draft: VaultSettingsConfig,
  patchDraft: PatchDraft,
  locks: {
    displayNameLocked: boolean;
    unlockedLockedHint: string | null;
    hiddenLocked: boolean;
    editHold: VaultConfigEditHold;
  },
  lists: VaultListsContext,
) {
  switch (sectionId) {
    case "vault":
      return (
        <VaultSection
          config={draft.vault}
          hiddenLocked={locks.hiddenLocked}
          displayNameLocked={locks.displayNameLocked}
          editHold={locks.editHold}
          onChange={(patch) => patchDraft("vault", patch)}
          fileManager={draft.file_manager}
          onFileManagerChange={(patch) => patchDraft("file_manager", patch)}
        />
      );
    case "unlocked_folder":
      return (
        <VaultUnlockedFolderSection
          config={draft.unlocked_folder}
          saved={lists.saved.unlocked}
          here={lists.here}
          vaultId={lists.vaultId}
          appUnlocked={lists.app.unlocked_folders}
          plaintext={draft.storage.mode === "upriv_plain"}
          lockedHint={locks.unlockedLockedHint}
          onChange={(patch) => patchDraft("unlocked_folder", patch)}
        />
      );
    case "auto_close":
      return (
        <VaultSettingsAutoCloseSection
          autoClose={draft.auto_close}
          onAutoCloseChange={(patch) => patchDraft("auto_close", patch)}
        />
      );
    case "backup":
      return (
        <VaultSettingsBackupSection
          config={draft.backup}
          lists={lists}
          onChange={(patch) => patchDraft("backup", patch)}
        />
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
  editHold,
  fileManager,
  onFileManagerChange,
}: {
  config: VaultSettingsConfig["vault"];
  onChange: (patch: Partial<VaultSettingsConfig["vault"]>) => void;
  hiddenLocked?: boolean;
  displayNameLocked?: boolean;
  editHold?: VaultConfigEditHold;
  fileManager: VaultSettingsConfig["file_manager"];
  onFileManagerChange: (patch: Partial<VaultSettingsConfig["file_manager"]>) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.fields}>
      <FieldLabel disabled={displayNameLocked}>
        {t("modal.settings.field.vault.display_name")}
      </FieldLabel>
      {displayNameLocked ? (
        <FieldHint>
          {t(requireVaultConfigEditLockedI18nKey("vault.display_name", editHold))}
        </FieldHint>
      ) : null}
      <ThemedInput
        value={config.display_name}
        maxLength={VAULT_DISPLAY_NAME_MAX_LENGTH}
        disabled={displayNameLocked}
        autoCorrect={false}
        spellCheck={false}
        onChangeText={(display_name) => onChange({ display_name })}
      />
      {displayNameLocked ? null : <DisplayNameFieldError name={config.display_name} />}
      <FieldLabel>{t("modal.settings.field.vault.order")}</FieldLabel>
      <FieldHint>{t("modal.settings.field.vault.order_help")}</FieldHint>
      <IntegerInput min={0} value={config.order} onChange={(order) => onChange({ order })} />
      <FieldLabel>{t("modal.settings.password_hint")}</FieldLabel>
      <FieldHint>{t("modal.settings.field.vault.password_hint_help")}</FieldHint>
      <ThemedInput
        value={config.password_hint}
        maxLength={VAULT_PASSWORD_HINT_MAX_LENGTH}
        onChangeText={(password_hint) => onChange({ password_hint })}
      />
      <FieldLabel>{t("modal.settings.note")}</FieldLabel>
      <FieldHint>
        {t("modal.settings.field.vault.note_help", { max: String(VAULT_NOTE_MAX_LENGTH) })}
      </FieldHint>
      <LongTextInput
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
      <SwitchRow
        label={t("modal.settings.field.file_manager.confirm_delete")}
        hint={t("modal.settings.field.file_manager.confirm_delete_help")}
        value={fileManager.confirm_delete}
        onValueChange={(confirm_delete) => onFileManagerChange({ confirm_delete })}
      />
    </View>
  );
}

/**
 * The storage value's two options, in the create wizard and on the Storage
 * screen. "Only files I choose" and the folder note sit in the plain-text
 * option's footer, shown always and dimmed until that option is chosen.
 */
export function VaultSettingsStorageSection({
  config,
  onChange,
  disabled = false,
  disabledLine = null,
  plainNote,
}: {
  config: VaultSettingsConfig["storage"];
  onChange: (patch: Partial<VaultSettingsConfig["storage"]>) => void;
  /** The choice takes no input: a copied store's value, or a change that runs. */
  disabled?: boolean;
  /** Why the choice cannot change, above the options. */
  disabledLine?: string | null;
  /** Under the plain-text option: where its files would be written on this device. */
  plainNote?: ReactNode;
}) {
  const { t } = useTranslation();
  const warning = STORAGE_WARNING[config.mode];
  return (
    <View style={styles.fields}>
      <FieldHint>{t("modal.storage.intro")}</FieldHint>
      <FieldLabel disabled={disabled}>{t("modal.storage.field.mode")}</FieldLabel>
      <FieldHint>{t("modal.storage.field.mode_help")}</FieldHint>
      {disabledLine ? <FieldHint>{disabledLine}</FieldHint> : null}
      <RadioGroup>
        {STORAGE_RADIOS.map(({ mode, badge, tone }) => (
          <PolicyRadioOption
            key={mode}
            value={mode}
            checked={config.mode === mode}
            disabled={disabled}
            title={t(`modal.storage.option.${mode}` as I18nKey)}
            description={t(`modal.storage.option.${mode}_desc` as I18nKey)}
            badge={badge}
            tone={tone}
            footer={
              mode === "upriv_plain" ? (
                <View style={styles.fields}>
                  <SwitchRow
                    label={t("modal.storage.field.plain_files")}
                    hint={t("modal.storage.field.plain_files_help")}
                    value={config.plain_files === "chosen"}
                    disabled={disabled}
                    onValueChange={(chosen) =>
                      onChange({ plain_files: chosen ? "chosen" : "whole" })
                    }
                  />
                  {plainNote}
                </View>
              ) : undefined
            }
            onSelect={() => onChange({ mode })}
          />
        ))}
      </RadioGroup>
      {warning ? <FieldHint>{t(warning)}</FieldHint> : null}
    </View>
  );
}

export function VaultSettingsAutoCloseSection({
  autoClose,
  onAutoCloseChange,
}: {
  autoClose: VaultSettingsConfig["auto_close"];
  onAutoCloseChange: (patch: Partial<VaultSettingsConfig["auto_close"]>) => void;
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.fields}>
      <SwitchRow
        label={t("modal.settings.field.auto_close.enabled")}
        value={autoClose.enabled}
        onValueChange={(enabled) => onAutoCloseChange({ enabled })}
      />
      <FieldLabel disabled={!autoClose.enabled}>
        {t("modal.settings.field.auto_close.when_busy")}
      </FieldLabel>
      <FieldHint disabled={!autoClose.enabled}>
        {t("modal.settings.field.auto_close.when_busy_help")}
      </FieldHint>
      <RadioGroup>
        {AUTO_CLOSE_WHEN_BUSY.map((value) => (
          <PolicyRadioOption
            key={value}
            value={value}
            checked={autoClose.when_busy === value}
            disabled={!autoClose.enabled}
            title={t(`modal.settings.field.auto_close.when_busy.${value}`)}
            onSelect={() => onAutoCloseChange({ when_busy: value })}
          />
        ))}
      </RadioGroup>
      <FieldLabel disabled={!autoClose.enabled}>
        {t("modal.settings.field.auto_close.idle_minutes")}
      </FieldLabel>
      <FieldHint disabled={!autoClose.enabled}>
        {t("modal.settings.field.auto_close.idle_minutes_help")}
      </FieldHint>
      <IntegerInput
        min={IDLE_AUTO_CLOSE_MINUTES_MIN}
        max={IDLE_AUTO_CLOSE_MINUTES_MAX}
        disabled={!autoClose.enabled}
        value={autoClose.idle_minutes}
        onChange={(idle_minutes) => onAutoCloseChange({ idle_minutes })}
      />
    </View>
  );
}

export function VaultSettingsBackupSection({
  config,
  lists,
  onChange,
}: {
  config: VaultSettingsConfig["backup"];
  lists: VaultListsContext;
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
      <SwitchRow
        label={t("modal.settings.field.backup.skip_unchanged")}
        hint={t("modal.settings.field.backup.skip_unchanged_help")}
        value={config.skip_unchanged}
        disabled={!config.enabled}
        onValueChange={(skip_unchanged) => onChange({ skip_unchanged })}
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
      <IntegerInput
        min={1}
        max={99}
        disabled={!config.enabled || config.mode !== "keep_last"}
        value={config.keep_last}
        onChange={(keep_last) => onChange({ keep_last })}
      />
      <VaultBackupFolderField
        devices={config.devices}
        saved={lists.saved.backups}
        here={lists.here}
        vaultId={lists.vaultId}
        appBackups={lists.app.backups}
        onChange={(devices) => onChange({ devices })}
      />
    </View>
  );
}

export function KdfSection({
  config,
  onChange,
  choosesPreset = true,
  archivePreset = null,
}: {
  config: { unlock_preset: KdfUnlockPreset };
  onChange: (patch: Partial<{ unlock_preset: KdfUnlockPreset }>) => void;
  choosesPreset?: boolean;
  archivePreset?: KdfUnlockPreset | null;
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
          const selected = choosesPreset ? config.unlock_preset : archivePreset;
          return (
            <PolicyRadioOption
              key={preset}
              value={preset}
              checked={selected === preset}
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

export function VaultSettingsGroupSection({
  groups,
  selectedGroupId,
  newGroupName,
  includeHidden = false,
  onSelectedGroupIdChange,
  onNewGroupNameChange,
}: {
  groups: readonly VaultGroup[];
  selectedGroupId: string;
  newGroupName: string;
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
        autoCorrect={false}
        spellCheck={false}
        onChangeText={onNewGroupNameChange}
        placeholder={t("vault.group.create.name_label")}
      />
      <DisplayNameFieldError name={newGroupName} allowEmpty />
      <FieldHint>{t("vault.create.group_create_help")}</FieldHint>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  fields: { gap: spacing.md },
  multiline: { minHeight: 88, textAlignVertical: "top" },
});
