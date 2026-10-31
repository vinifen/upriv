import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import {
  createVaultChoosesKdf,
  createVaultErrorI18nKey,
  createVaultErrorsForField,
  createVaultImportNeedsArchivePassword,
  createVaultImportNeedsRename,
  createVaultImportSelectionPatch,
  createVaultSettingsLocked,
  importExtractApplies,
  importExtractEnabled,
  importKeepSettingsApplies,
  importKeepWorkspaceApplies,
  validateCreateVaultStep,
  importSetsVaultPassword,
  importZipWrapsDocuments,
  isHiddenGroup,
  groupsForAssignmentPicker,
  groupAssignmentClearOption,
  NO_VAULT_GROUPS,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  VAULT_NOTE_MAX_LENGTH,
  VAULT_PASSWORD_HINT_MAX_LENGTH,
  type CreateVaultDraft,
  type CreateVaultStepId,
  type CreateVaultValidationCode,
  type VaultGroup,
  type WorkspaceTable,
} from "@upriv/shared";
import {
  importFolderListingError,
  releasePendingImport,
  subscribeImportFolderListing,
} from "@/platform/native/contentTreeImport";
import { useCreateVaultService } from "@/platform/services";
import { useTranslation, type I18nKey } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import { LongTextInput } from "@/components/LongTextInput";
import { PathField } from "@/components/PathField";
import { Button, Select } from "@/components/ui";
import { IntegerInput, PolicyRadioOption, SettingsAccordionSection } from "@/components/settings";
import {
  FieldHint,
  FieldLabel,
  PasswordInput,
  RadioGroup,
  SwitchRow,
  ThemedInput,
  DisplayNameFieldError,
} from "@/components/settings/settingsFields";
import {
  KdfSection,
  PlainFilesSwitch,
  VaultSettingsAutoCloseSection,
  VaultSettingsBackupSection,
  VaultSettingsMountSection,
} from "@/features/vaults/settings/vaultSettingsForm";
import type { CreateVaultStepFocusProps } from "@upriv/shared/react";

let importPickGeneration = 0;

/** Drop a folder or file pick that finishes after the wizard moved on. */
export function invalidateImportPicks(): void {
  importPickGeneration += 1;
}

interface StepProps extends Partial<CreateVaultStepFocusProps> {
  draft: CreateVaultDraft;
  errors: readonly CreateVaultValidationCode[];
  onChange: (patch: Partial<CreateVaultDraft>) => void;
  groups?: readonly VaultGroup[];
  includeHidden?: boolean;
  /** Resolved vault-root for mount reserved checks (from wizard / CreateVaultModal). */
  vaultRootPath?: string | null;
  appWorkspace?: WorkspaceTable;
  /** Display names already on the vault list, so a picked file can take `name 2`. */
  existingDisplayNames?: readonly string[];
}

/** Says why fields are locked and where to go. Shows only while they are. */
function SettingsLockedNotice({ draft }: { draft: CreateVaultDraft }) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  if (!createVaultSettingsLocked(draft)) return null;
  return (
    <View
      accessibilityRole="alert"
      style={[styles.lockedNotice, { borderColor: colors.vaultStatusRecovery }]}
    >
      <Text style={typography.body}>{t("vault.create.settings_locked")}</Text>
    </View>
  );
}

/**
 * Inputs a `.7z` may fill. They lock until its password test passes; the step
 * and the section around them stay open.
 */
function SettingsLockedFields({
  draft,
  children,
}: {
  draft: CreateVaultDraft;
  children: ReactNode;
}) {
  const locked = createVaultSettingsLocked(draft);
  return (
    <View
      pointerEvents={locked ? "none" : "auto"}
      accessibilityElementsHidden={locked}
      importantForAccessibility={locked ? "no-hide-descendants" : "auto"}
      style={locked ? styles.locked : undefined}
    >
      {children}
    </View>
  );
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

function CreateVaultSourceStep({ draft, errors, onChange, existingDisplayNames = [] }: StepProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const createVaultService = useCreateVaultService();
  const [pickError, setPickError] = useState<"file" | "folder" | null>(null);
  const folderListingFailed = useSyncExternalStore(
    subscribeImportFolderListing,
    () =>
      draft.importShape === "directory" && importFolderListingError(draft.importFilePath) != null,
    () => false,
  );

  const changeSource = (patch: Partial<CreateVaultDraft>) => {
    invalidateImportPicks();
    setPickError(null);
    const previous = draft.importFilePath;
    const next = patch.importFilePath ?? previous;
    onChange(patch);
    if (previous && previous !== next) void releasePendingImport(previous).catch(() => undefined);
  };

  const applyPicked = (picked: { path: string; fileName: string; shape: "file" | "directory" }) => {
    onChange(createVaultImportSelectionPatch(picked, draft.importFilePath, existingDisplayNames));
  };

  const acceptPicked = (
    generation: number,
    picked: { path: string; fileName: string } | null,
    shape: "file" | "directory",
  ) => {
    if (!picked) return;
    if (generation !== importPickGeneration) {
      void releasePendingImport(picked.path).catch(() => undefined);
      return;
    }
    const previous = draft.importFilePath;
    if (previous && previous !== picked.path) {
      void releasePendingImport(previous).catch(() => undefined);
    }
    applyPicked({ ...picked, shape });
  };

  const chooseImportFile = () => {
    const generation = importPickGeneration;
    setPickError(null);
    void createVaultService
      .selectImportPackageForProbe()
      .then((picked) => {
        acceptPicked(generation, picked, "file");
      })
      .catch(() => {
        if (generation !== importPickGeneration) return;
        setPickError("file");
      });
  };

  const chooseImportFolder = () => {
    const generation = importPickGeneration;
    setPickError(null);
    void createVaultService
      .selectImportFolder?.()
      .then((picked) => {
        acceptPicked(generation, picked, "directory");
      })
      .catch(() => {
        if (generation !== importPickGeneration) return;
        setPickError("folder");
      });
  };

  const showExtract = importExtractApplies(draft);
  const extractOn = importExtractEnabled(draft);
  const archiveName = draft.importFileName.trim().toLowerCase();
  const showFolder = Platform.OS === "android" && Boolean(createVaultService.selectImportFolder);
  // Import chosen and still missing a usable file or folder (not while a zip is being read).
  const importNeedsStep =
    draft.source === "import" &&
    validateCreateVaultStep("source", draft, []).some((code) => code !== "import_zip_pending");

  const importFilePicker = (
    <View style={styles.fields}>
      <PathField
        value={draft.source === "import" ? draft.importFileName : ""}
        openPath={draft.source === "import" ? draft.importFilePath : ""}
        editable={false}
        placeholder={t("vault.create.import_file_placeholder")}
      />
      <Button
        label={t("vault.create.action.choose_file")}
        variant="ghost"
        onPress={chooseImportFile}
      />
      {showFolder ? (
        <Button
          label={t("vault.create.action.choose_folder")}
          variant="ghost"
          onPress={chooseImportFolder}
        />
      ) : null}
      {pickError || folderListingFailed ? (
        <Text
          accessibilityRole="alert"
          style={[typography.caption, { color: colors.onErrorContainer }]}
        >
          {t(
            pickError === "file"
              ? "error.import_source_unreadable"
              : "vault.create.import_folder_unreadable",
          )}
        </Text>
      ) : null}
      {showExtract ? (
        <SwitchRow
          label={t("vault.create.extract")}
          hint={t("vault.create.extract_hint")}
          value={draft.importExtract}
          onValueChange={(importExtract) =>
            onChange({
              importExtract,
              password: "",
              passwordConfirm: "",
              passwordValidated: false,
              passwordTestFailed: false,
              passwordProbeUnavailable: false,
            })
          }
        />
      ) : null}
      {importKeepWorkspaceApplies(draft) ? (
        <SwitchRow
          label={t("vault.create.keep_workspace")}
          hint={t("vault.create.keep_workspace_hint")}
          value={draft.importKeepWorkspace}
          onValueChange={(importKeepWorkspace) => onChange({ importKeepWorkspace })}
        />
      ) : null}
      {importKeepSettingsApplies(draft) ? (
        <SwitchRow
          label={t("vault.create.keep_settings")}
          hint={t("vault.create.keep_settings_hint")}
          value={draft.importKeepSettings}
          onValueChange={(importKeepSettings) => onChange({ importKeepSettings })}
        />
      ) : null}
      {draft.source === "import" && draft.importShape === "directory" ? (
        <Text style={[typography.caption, { color: colors.onSurfaceVariant }]}>
          {t("vault.create.option.import_folder_note")}
        </Text>
      ) : null}
      {draft.source === "import" &&
      draft.importShape === "directory" &&
      draft.importFilePath.startsWith("content:") ? (
        <Text style={[typography.caption, { color: colors.onSurfaceVariant }]}>
          {t("vault.create.option.import_folder_dot_note")}
        </Text>
      ) : null}
      {extractOn && archiveName.endsWith(".7z") ? (
        <Text
          accessibilityRole="alert"
          style={[typography.caption, { color: colors.onErrorContainer }]}
        >
          {t("vault.create.option.import_7z_warn")}
        </Text>
      ) : null}
      {extractOn && draft.zipLayout === "files" ? (
        <Text
          accessibilityRole="alert"
          style={[typography.caption, { color: colors.onErrorContainer }]}
        >
          {t(
            draft.importCarriesSettings && draft.importKeepSettings
              ? "vault.create.option.import_plain_zip_note"
              : "vault.create.option.import_files_zip_note",
          )}
        </Text>
      ) : null}
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
            changeSource({
              source: "scratch",
              importFileName: "",
              importFilePath: "",
              importKind: "file",
              importShape: "file",
              importExtract: true,
              zipLayout: null,
              importZipRejected: false,
              importZipProbeFailed: false,
              passwordValidated: false,
              passwordTestFailed: false,
              passwordProbeUnavailable: false,
            })
          }
        />
        <PolicyRadioOption
          value="import"
          checked={draft.source === "import"}
          attention={importNeedsStep}
          title={t("vault.create.option.import")}
          description={t("vault.create.option.import_desc")}
          footer={importFilePicker}
          onSelect={() => {
            if (draft.source === "import") return;
            changeSource({
              source: "import",
              importFileName: "",
              importFilePath: "",
              importKind: "file",
              importShape: "file",
              importExtract: true,
              zipLayout: null,
              importZipRejected: false,
              importZipProbeFailed: false,
              password: "",
              passwordConfirm: "",
              passwordValidated: false,
              passwordTestFailed: false,
              passwordProbeUnavailable: false,
            });
          }}
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
  onFieldSubmit,
}: StepProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  const importNeedsRename = createVaultImportNeedsRename(draft);
  const locked = createVaultSettingsLocked(draft);
  return (
    <View style={styles.fields}>
      <Text style={typography.bodyMuted}>{t("vault.create.identity_intro")}</Text>
      {importNeedsRename ? (
        <Text style={typography.bodyMuted}>{t("vault.import.rename_prompt")}</Text>
      ) : null}
      <SettingsLockedNotice draft={draft} />
      <SettingsLockedFields draft={draft}>
        <View style={styles.fields}>
          <FieldLabel>
            {importNeedsRename ? t("vault.import.suggested_name") : t("vault.name.label")}
          </FieldLabel>
          <ThemedInput
            ref={bindFieldRef?.("displayName")}
            value={draft.displayName}
            editable={!locked}
            maxLength={VAULT_DISPLAY_NAME_MAX_LENGTH}
            autoCorrect={false}
            spellCheck={false}
            onFocus={() => onFieldFocus?.("displayName")}
            onChangeText={(displayName) => onChange({ displayName })}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => onFieldSubmit?.("displayName")}
          />
          <DisplayNameFieldError name={draft.displayName} allowEmpty />
          <FieldErrors
            errors={createVaultErrorsForField(errors, "displayName").filter(
              (code) => code === "empty" || code === "duplicate",
            )}
          />
          <FieldLabel>{t("vault.create.note")}</FieldLabel>
          <FieldHint>
            {t("vault.create.note_help", { max: String(VAULT_NOTE_MAX_LENGTH) })}
          </FieldHint>
          <LongTextInput
            ref={bindFieldRef?.("note")}
            value={draft.note}
            editable={!locked}
            maxLength={VAULT_NOTE_MAX_LENGTH}
            onFocus={() => onFieldFocus?.("note")}
            onChangeText={(note) => onChange({ note })}
            multiline
            style={styles.multiline}
          />
        </View>
      </SettingsLockedFields>
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
  onFieldSubmit,
}: StepProps & { onTestImportPassword?: () => void; testingPassword?: boolean }) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const isImport = draft.source === "import";
  const wrapsDocuments = importZipWrapsDocuments(draft);
  const setsVaultPassword = !isImport || importSetsVaultPassword(draft);
  const needsArchivePassword = createVaultImportNeedsArchivePassword(draft);
  const showPassword = setsVaultPassword || needsArchivePassword;
  const hintLocked = createVaultSettingsLocked(draft);

  return (
    <View style={styles.fields}>
      <Text style={typography.bodyMuted}>
        {wrapsDocuments
          ? t("vault.create.password_files_intro")
          : needsArchivePassword
            ? t("vault.create.password_import_intro")
            : setsVaultPassword
              ? isImport
                ? t("vault.create.password_wrap_intro")
                : t("vault.create.password_scratch_intro")
              : t("vault.create.password_import_copy_intro")}
      </Text>
      {showPassword ? (
        <>
          <FieldLabel>{t("vault.create.password")}</FieldLabel>
          <PasswordInput
            value={draft.password}
            ref={bindFieldRef?.("password")}
            autoComplete="password-new"
            onFocus={() => onFieldFocus?.("password")}
            onSubmitEditing={() => onFieldSubmit?.("password")}
            returnKeyType="next"
            submitBehavior="submit"
            onChangeText={(password) =>
              onChange({
                password,
                passwordValidated: false,
                passwordTestFailed: false,
                passwordProbeUnavailable: false,
              })
            }
          />
        </>
      ) : null}
      <FieldErrors errors={createVaultErrorsForField(errors, "password")} />
      {setsVaultPassword ? (
        <>
          <FieldLabel>{t("vault.create.password_confirm")}</FieldLabel>
          <PasswordInput
            value={draft.passwordConfirm}
            ref={bindFieldRef?.("passwordConfirm")}
            autoComplete="password-new"
            onFocus={() => onFieldFocus?.("passwordConfirm")}
            onSubmitEditing={() => onFieldSubmit?.("passwordConfirm")}
            returnKeyType="next"
            submitBehavior="submit"
            onChangeText={(passwordConfirm) => onChange({ passwordConfirm })}
          />
          <FieldErrors errors={createVaultErrorsForField(errors, "passwordConfirm")} />
        </>
      ) : needsArchivePassword ? (
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
      ) : null}
      {needsArchivePassword && draft.passwordValidated && draft.importKeepSettings ? (
        <Text accessibilityRole="alert" style={typography.bodyMuted}>
          {t(
            draft.importCarriesSettings
              ? "vault.create.password_settings_read"
              : "vault.create.password_no_settings",
          )}
        </Text>
      ) : null}
      <FieldLabel>{t("vault.create.password_hint")}</FieldLabel>
      <FieldHint>
        {t(hintLocked ? "vault.create.password_hint_locked" : "vault.create.password_hint_help")}
      </FieldHint>
      <ThemedInput
        ref={bindFieldRef?.("passwordHint")}
        value={draft.passwordHint}
        editable={!hintLocked}
        maxLength={VAULT_PASSWORD_HINT_MAX_LENGTH}
        onFocus={() => onFieldFocus?.("passwordHint")}
        onChangeText={(passwordHint) => onChange({ passwordHint })}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => onFieldSubmit?.("passwordHint")}
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
      <SettingsLockedNotice draft={draft} />

      <SettingsAccordionSection title={t("modal.settings.section.kdf")} defaultOpen>
        <SettingsLockedFields draft={draft}>
          <KdfSection
            config={draft.kdf}
            choosesPreset={createVaultChoosesKdf(draft)}
            archivePreset={draft.archiveUnlockPreset}
            onChange={(patch) => onChange({ kdf: { ...draft.kdf, ...patch } })}
          />
        </SettingsLockedFields>
      </SettingsAccordionSection>

      <SettingsAccordionSection title={t("modal.settings.section.backup")} defaultOpen>
        <SettingsLockedFields draft={draft}>
          <VaultSettingsBackupSection
            config={draft.backup}
            onChange={(patch) => onChange({ backup: { ...draft.backup, ...patch } })}
          />
        </SettingsLockedFields>
      </SettingsAccordionSection>

      <SettingsAccordionSection title={t("modal.settings.section.auto_close")} defaultOpen>
        <SettingsLockedFields draft={draft}>
          <VaultSettingsAutoCloseSection
            autoClose={draft.auto_close}
            onAutoCloseChange={(patch) =>
              onChange({ auto_close: { ...draft.auto_close, ...patch } })
            }
          />
        </SettingsLockedFields>
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
            autoCorrect={false}
            spellCheck={false}
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
          <DisplayNameFieldError name={draft.groupName} allowEmpty />
          <FieldHint>{t("vault.create.group_create_help")}</FieldHint>
        </View>
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
  appWorkspace,
}: StepProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  const hiddenLocked = draft.groupMode === "existing" && isHiddenGroup(groups, draft.groupId);

  const patchStorage = (patch: Partial<CreateVaultDraft["storage"]>) => {
    onChange({ storage: { ...draft.storage, ...patch } });
  };

  return (
    <View style={styles.fields}>
      <Text style={typography.bodyMuted}>{t("vault.create.advanced_intro")}</Text>
      <FieldHint>{t("vault.create.settings_editable_later")}</FieldHint>
      <SettingsLockedNotice draft={draft} />

      <SettingsAccordionSection title={t("modal.settings.section.vault")}>
        <SettingsLockedFields draft={draft}>
          <View style={styles.fields}>
            <FieldLabel>{t("modal.settings.field.vault.order")}</FieldLabel>
            <FieldHint>{t("modal.settings.field.vault.order_help")}</FieldHint>
            <IntegerInput min={0} value={draft.order} onChange={(order) => onChange({ order })} />
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
        </SettingsLockedFields>
      </SettingsAccordionSection>

      <SettingsAccordionSection title={t("modal.settings.section.storage")}>
        <SettingsLockedFields draft={draft}>
          <View style={styles.fields}>
            <FieldLabel>{t("modal.settings.field.storage.mode")}</FieldLabel>
            <FieldHint>{t("modal.settings.field.storage.mode_help")}</FieldHint>
            <RadioGroup>
              {(
                [
                  ["encrypted_dir", "recommended", "default"],
                  ["upriv_plain", "not-recommended", "less-secure"],
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
                  footer={
                    mode === "upriv_plain" ? (
                      <PlainFilesSwitch config={draft.storage} onChange={patchStorage} />
                    ) : undefined
                  }
                  onSelect={() => patchStorage({ mode })}
                />
              ))}
            </RadioGroup>
            {draft.storage.mode === "encrypted_dir" ? (
              <FieldHint>{t("warning.encrypted_dir_ram")}</FieldHint>
            ) : null}
            {draft.storage.mode === "upriv_plain" ? (
              <FieldHint>{t("warning.upriv_plain")}</FieldHint>
            ) : null}
            <FieldErrors errors={createVaultErrorsForField(errors, "storage")} />
          </View>
        </SettingsLockedFields>
      </SettingsAccordionSection>

      <SettingsAccordionSection title={t("modal.settings.section.mount")}>
        <SettingsLockedFields draft={draft}>
          <VaultSettingsMountSection
            config={draft.mount}
            vaultRootPath={vaultRootPath}
            plaintext={draft.storage.mode === "upriv_plain"}
            appWorkspace={appWorkspace}
            onChange={(patch) => onChange({ mount: { ...draft.mount, ...patch } })}
          />
        </SettingsLockedFields>
        <FieldErrors errors={createVaultErrorsForField(errors, "mount")} />
      </SettingsAccordionSection>
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.md },
  multiline: { minHeight: 88, textAlignVertical: "top" },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  fieldErrors: { gap: 2, marginTop: -spacing.sm },
  locked: { opacity: 0.6 },
  lockedNotice: { borderWidth: 1, borderRadius: 8, padding: spacing.sm },
});
