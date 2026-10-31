import { useId, type ReactNode } from "react";
import { PathField } from "@/components/PathField";
import { Button, PasswordInput, SwitchRow } from "@/components/ui";
import {
  createVaultChoosesKdf,
  createVaultErrorsForField,
  createVaultImportNeedsArchivePassword,
  createVaultImportNeedsRename,
  createVaultImportSelectionPatch,
  createVaultSettingsLocked,
  importExtractApplies,
  importExtractEnabled,
  importKeepSettingsApplies,
  importKeepWorkspaceApplies,
  importSetsVaultPassword,
  importZipWrapsDocuments,
  isHiddenGroup,
  validateCreateVaultStep,
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
import type { CreateVaultStepFocusProps } from "@upriv/shared/react";
import { useCreateVaultService } from "@/platform/services";
import { useTranslation } from "@/i18n";
import {
  DisplayNameFieldError,
  PolicyRadioOption,
  IntegerInput,
  settingsControlClass,
  SettingsField,
  SettingsFormGrid,
  VaultSettingsBackupSection,
  VaultSettingsCloseSection,
  VaultSettingsGroupSection,
  VaultSettingsKdfSection,
  VaultSettingsMountSection,
  VaultSettingsSection,
  VaultSettingsStorageSection,
} from "@/components/settings";
import { createVaultErrorI18nKey } from "@/lib/errorMessages";

interface StepProps extends Partial<CreateVaultStepFocusProps> {
  draft: CreateVaultDraft;
  errors: readonly CreateVaultValidationCode[];
  onChange: (patch: Partial<CreateVaultDraft>) => void;
  /** Existing groups for deferred assignment on the General step. */
  groups?: readonly VaultGroup[];
  /** Show hidden groups in the assignment picker (same toggle as the vault list). */
  includeHidden?: boolean;
  /** Resolved vault-root for mount reserved checks (from wizard / CreateVaultModal). */
  vaultRootPath?: string | null;
  /** App workspace, so a new vault can follow that file manager folder. */
  appWorkspace?: WorkspaceTable;
  /** Selected file-manager choice still needs the WinFsp driver. */
  onDriverAttentionChange?: (active: boolean) => void;
  /** Display names already on the vault list, so a picked file can take `name 2`. */
  existingDisplayNames?: readonly string[];
}

let importPickGeneration = 0;

export function invalidateImportPicks(): void {
  importPickGeneration += 1;
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
  if (errors.length === 0) return null;

  return (
    <div role="alert" className="space-y-0.5">
      {errors.map((code) => (
        <p key={code} className="text-xs text-on-error-container">
          {t(
            createVaultErrorI18nKey(code),
            code === "too_long" || code === "group_name_too_long"
              ? { max: VAULT_DISPLAY_NAME_MAX_LENGTH }
              : undefined,
          )}
        </p>
      ))}
    </div>
  );
}

/** Says why fields are locked and where to go. Shows only while they are. */
function SettingsLockedNotice({ draft }: { draft: CreateVaultDraft }) {
  const { t } = useTranslation();
  if (!createVaultSettingsLocked(draft)) return null;
  return (
    <p
      role="status"
      className="rounded-lg border border-[var(--vault-status-recovery)] px-3 py-2 text-sm leading-relaxed text-on-surface"
    >
      {t("vault.create.settings_locked")}
    </p>
  );
}

/**
 * Inputs a `.7z` may fill. They lock until its password test passes; the step
 * and the section around them stay open. Disabling the fieldset reaches every
 * control in it, keyboard included.
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
    <fieldset disabled={locked} className={locked ? "min-w-0 opacity-60" : "min-w-0"}>
      {children}
    </fieldset>
  );
}

function CreateVaultSourceStep({ draft, errors, onChange, existingDisplayNames = [] }: StepProps) {
  const { t } = useTranslation();
  const createVaultService = useCreateVaultService();
  const sourceGroup = useId();

  const applyPicked = (picked: { path: string; fileName: string; shape: "file" | "directory" }) => {
    onChange(createVaultImportSelectionPatch(picked, draft.importFilePath, existingDisplayNames));
  };

  const acceptPicked = (
    generation: number,
    picked: { path: string; fileName: string } | null,
    shape: "file" | "directory",
  ) => {
    if (!picked || generation !== importPickGeneration) return;
    applyPicked({ ...picked, shape });
  };

  const handleImportFile = () => {
    const generation = importPickGeneration;
    void createVaultService.selectImportPackageForProbe().then((picked) => {
      acceptPicked(generation, picked, "file");
    });
  };

  const handleImportFolder = () => {
    const generation = importPickGeneration;
    void createVaultService.selectImportFolder?.().then((picked) => {
      acceptPicked(generation, picked, "directory");
    });
  };

  const showExtract = importExtractApplies(draft);
  const extractOn = importExtractEnabled(draft);
  const archiveName = draft.importFileName.trim().toLowerCase();
  // Import chosen and still missing a usable file or folder (not while a zip is being read).
  const importNeedsStep =
    draft.source === "import" &&
    validateCreateVaultStep("source", draft, []).some((code) => code !== "import_zip_pending");

  const importFilePicker = (
    <div className="space-y-2">
      <PathField
        value={draft.source === "import" ? draft.importFileName : ""}
        openPath={draft.source === "import" ? draft.importFilePath : ""}
        readOnly
        placeholder={t("vault.create.import_file_placeholder")}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="md" onClick={handleImportFile}>
          {t("vault.create.action.choose_file")}
        </Button>
        {createVaultService.selectImportFolder ? (
          <Button type="button" variant="ghost" size="md" onClick={handleImportFolder}>
            {t("vault.create.action.choose_folder")}
          </Button>
        ) : null}
      </div>
      {showExtract ? (
        <SwitchRow
          checked={draft.importExtract}
          label={t("vault.create.extract")}
          hint={t("vault.create.extract_hint")}
          onChange={(importExtract) =>
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
          checked={draft.importKeepWorkspace}
          label={t("vault.create.keep_workspace")}
          hint={t("vault.create.keep_workspace_hint")}
          onChange={(importKeepWorkspace) => onChange({ importKeepWorkspace })}
        />
      ) : null}
      {importKeepSettingsApplies(draft) ? (
        <SwitchRow
          checked={draft.importKeepSettings}
          label={t("vault.create.keep_settings")}
          hint={t("vault.create.keep_settings_hint")}
          onChange={(importKeepSettings) => onChange({ importKeepSettings })}
        />
      ) : null}
      {draft.source === "import" && draft.importShape === "directory" ? (
        <p className="text-xs text-on-surface-variant">
          {t("vault.create.option.import_folder_note")}
        </p>
      ) : null}
      {extractOn && archiveName.endsWith(".7z") ? (
        <p role="alert" className="text-xs text-on-error-container">
          {t("vault.create.option.import_7z_warn")}
        </p>
      ) : null}
      {extractOn && draft.zipLayout === "files" ? (
        <p role="alert" className="text-xs text-on-error-container">
          {t(
            draft.importCarriesSettings && draft.importKeepSettings
              ? "vault.create.option.import_plain_zip_note"
              : "vault.create.option.import_files_zip_note",
          )}
        </p>
      ) : null}
    </div>
  );

  return (
    <SettingsFormGrid>
      <p className="text-sm text-on-surface-variant">{t("vault.create.source_intro")}</p>
      <div role="radiogroup" aria-label={t("vault.create.source_title")} className="grid gap-2">
        <PolicyRadioOption
          groupName={sourceGroup}
          value="scratch"
          checked={draft.source === "scratch"}
          title={t("vault.create.option.scratch")}
          description={t("vault.create.option.scratch_desc")}
          badge="default"
          onSelect={() => {
            invalidateImportPicks();
            onChange({
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
            });
          }}
        />
        <PolicyRadioOption
          groupName={sourceGroup}
          value="import"
          checked={draft.source === "import"}
          attention={importNeedsStep}
          title={t("vault.create.option.import")}
          description={t("vault.create.option.import_desc")}
          footer={importFilePicker}
          onSelect={() => {
            if (draft.source === "import") return;
            invalidateImportPicks();
            onChange({
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
      </div>
      <FieldErrors errors={createVaultErrorsForField(errors, "source")} />
    </SettingsFormGrid>
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
  const nameId = useId();
  const noteId = useId();
  const importNeedsRename = createVaultImportNeedsRename(draft);

  return (
    <SettingsFormGrid>
      <p className="text-sm text-on-surface-variant">{t("vault.create.identity_intro")}</p>
      {importNeedsRename ? (
        <p className="text-sm leading-relaxed text-on-surface-variant">
          {t("vault.import.rename_prompt")}
        </p>
      ) : null}
      <SettingsLockedNotice draft={draft} />
      <SettingsLockedFields draft={draft}>
        <SettingsFormGrid>
          <SettingsField
            label={importNeedsRename ? t("vault.import.suggested_name") : t("vault.name.label")}
            htmlFor={nameId}
          >
            <input
              id={nameId}
              ref={bindFieldRef?.("displayName")}
              type="text"
              value={draft.displayName}
              maxLength={VAULT_DISPLAY_NAME_MAX_LENGTH}
              onFocus={() => onFieldFocus?.("displayName")}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onFieldSubmit?.("displayName");
                }
              }}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => onChange({ displayName: e.target.value })}
              className={settingsControlClass}
            />
            <DisplayNameFieldError name={draft.displayName} allowEmpty />
            <FieldErrors
              errors={createVaultErrorsForField(errors, "displayName").filter(
                (code) => code === "empty" || code === "duplicate",
              )}
            />
          </SettingsField>
          <SettingsField
            label={t("vault.create.note")}
            htmlFor={noteId}
            hint={t("vault.create.note_help", { max: VAULT_NOTE_MAX_LENGTH })}
          >
            <textarea
              id={noteId}
              ref={bindFieldRef?.("note")}
              value={draft.note}
              maxLength={VAULT_NOTE_MAX_LENGTH}
              rows={3}
              onFocus={() => onFieldFocus?.("note")}
              onChange={(e) => onChange({ note: e.target.value })}
              className={[settingsControlClass, "resize-y"].join(" ")}
            />
          </SettingsField>
        </SettingsFormGrid>
      </SettingsLockedFields>
    </SettingsFormGrid>
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
  const passwordId = useId();
  const confirmId = useId();
  const hintId = useId();
  const isImport = draft.source === "import";
  const wrapsDocuments = importZipWrapsDocuments(draft);
  const setsVaultPassword = !isImport || importSetsVaultPassword(draft);
  const needsArchivePassword = createVaultImportNeedsArchivePassword(draft);
  const showPassword = setsVaultPassword || needsArchivePassword;
  const hintLocked = createVaultSettingsLocked(draft);

  return (
    <SettingsFormGrid>
      <p className="text-sm text-on-surface-variant">
        {wrapsDocuments
          ? t("vault.create.password_files_intro")
          : needsArchivePassword
            ? t("vault.create.password_import_intro")
            : setsVaultPassword
              ? isImport
                ? t("vault.create.password_wrap_intro")
                : t("vault.create.password_scratch_intro")
              : t("vault.create.password_import_copy_intro")}
      </p>
      {showPassword ? (
        <SettingsField label={t("vault.create.password")} htmlFor={passwordId}>
          <PasswordInput
            id={passwordId}
            ref={bindFieldRef?.("password")}
            value={draft.password}
            autoComplete="new-password"
            onFocus={() => onFieldFocus?.("password")}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onFieldSubmit?.("password");
              }
            }}
            onChange={(e) =>
              onChange({
                password: e.target.value,
                passwordValidated: false,
                passwordTestFailed: false,
                passwordProbeUnavailable: false,
              })
            }
            inputClassName={settingsControlClass}
          />
          <FieldErrors errors={createVaultErrorsForField(errors, "password")} />
        </SettingsField>
      ) : (
        <FieldErrors errors={createVaultErrorsForField(errors, "password")} />
      )}
      {setsVaultPassword ? (
        <SettingsField label={t("vault.create.password_confirm")} htmlFor={confirmId}>
          <PasswordInput
            id={confirmId}
            ref={bindFieldRef?.("passwordConfirm")}
            value={draft.passwordConfirm}
            autoComplete="new-password"
            onFocus={() => onFieldFocus?.("passwordConfirm")}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onFieldSubmit?.("passwordConfirm");
              }
            }}
            onChange={(e) => onChange({ passwordConfirm: e.target.value })}
            inputClassName={settingsControlClass}
          />
          <FieldErrors errors={createVaultErrorsForField(errors, "passwordConfirm")} />
        </SettingsField>
      ) : needsArchivePassword ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={!draft.password.trim() || testingPassword}
            onClick={onTestImportPassword}
          >
            {testingPassword
              ? t("vault.create.action.testing_password")
              : t("vault.create.action.test_password")}
          </Button>
          {draft.passwordValidated ? (
            <span className="text-sm text-vault-open">{t("vault.create.password_validated")}</span>
          ) : null}
        </div>
      ) : null}
      {needsArchivePassword && draft.passwordValidated && draft.importKeepSettings ? (
        <p role="status" className="text-sm leading-relaxed text-on-surface-variant">
          {t(
            draft.importCarriesSettings
              ? "vault.create.password_settings_read"
              : "vault.create.password_no_settings",
          )}
        </p>
      ) : null}
      <SettingsField
        label={t("vault.create.password_hint")}
        htmlFor={hintId}
        hint={t(
          hintLocked ? "vault.create.password_hint_locked" : "vault.create.password_hint_help",
        )}
      >
        <input
          id={hintId}
          ref={bindFieldRef?.("passwordHint")}
          type="text"
          value={draft.passwordHint}
          disabled={hintLocked}
          maxLength={VAULT_PASSWORD_HINT_MAX_LENGTH}
          onFocus={() => onFieldFocus?.("passwordHint")}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onFieldSubmit?.("passwordHint");
            }
          }}
          onChange={(e) => onChange({ passwordHint: e.target.value })}
          className={settingsControlClass}
        />
      </SettingsField>
    </SettingsFormGrid>
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
  return (
    <div className="space-y-1.5 sm:space-y-2">
      <p className="text-sm text-on-surface-variant">{t("vault.create.general_intro")}</p>
      <SettingsLockedNotice draft={draft} />

      <VaultSettingsSection title={t("modal.settings.section.kdf")} defaultOpen>
        <SettingsLockedFields draft={draft}>
          <VaultSettingsKdfSection
            config={draft.kdf}
            choosesPreset={createVaultChoosesKdf(draft)}
            archivePreset={draft.archiveUnlockPreset}
            onChange={(patch) => onChange({ kdf: { ...draft.kdf, ...patch } })}
          />
        </SettingsLockedFields>
      </VaultSettingsSection>

      <VaultSettingsSection title={t("modal.settings.section.backup")} defaultOpen>
        <SettingsLockedFields draft={draft}>
          <VaultSettingsBackupSection
            config={draft.backup}
            onChange={(patch) => onChange({ backup: { ...draft.backup, ...patch } })}
          />
        </SettingsLockedFields>
      </VaultSettingsSection>

      <VaultSettingsSection title={t("modal.settings.section.auto_close")} defaultOpen>
        <SettingsLockedFields draft={draft}>
          <VaultSettingsCloseSection
            autoClose={draft.auto_close}
            onAutoCloseChange={(patch) =>
              onChange({ auto_close: { ...draft.auto_close, ...patch } })
            }
          />
        </SettingsLockedFields>
      </VaultSettingsSection>

      <VaultSettingsSection title={t("vault.group.assignment.section")} defaultOpen>
        <VaultSettingsGroupSection
          groups={groups}
          includeHidden={includeHidden}
          selectedGroupId={draft.groupMode === "existing" ? draft.groupId : ""}
          newGroupName={draft.groupName}
          onSelectedGroupIdChange={(nextId) => {
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
          onNewGroupNameChange={(groupName) => {
            if (groupName.trim()) {
              onChange({ groupMode: "create", groupName });
              return;
            }
            onChange({
              groupMode: draft.groupId ? "existing" : "none",
              groupName: "",
            });
          }}
        />
        <FieldErrors errors={createVaultErrorsForField(errors, "group")} />
      </VaultSettingsSection>
    </div>
  );
}

function CreateVaultAdvancedStep({
  draft,
  errors,
  onChange,
  groups = NO_VAULT_GROUPS,
  vaultRootPath = null,
  appWorkspace,
  onDriverAttentionChange,
}: StepProps) {
  const { t } = useTranslation();
  const orderId = useId();
  const hiddenId = useId();
  const hiddenLocked = draft.groupMode === "existing" && isHiddenGroup(groups, draft.groupId);

  return (
    <div className="space-y-1.5 sm:space-y-2">
      <p className="text-sm text-on-surface-variant">{t("vault.create.advanced_intro")}</p>
      <p className="text-sm leading-relaxed text-on-surface-variant">
        {t("vault.create.settings_editable_later")}
      </p>
      <SettingsLockedNotice draft={draft} />

      <VaultSettingsSection title={t("modal.settings.section.vault")}>
        <SettingsLockedFields draft={draft}>
          <SettingsFormGrid>
            <SettingsField
              label={t("modal.settings.field.vault.order")}
              hint={t("modal.settings.field.vault.order_help")}
              htmlFor={orderId}
            >
              <IntegerInput
                id={orderId}
                min={0}
                value={draft.order}
                onChange={(order) => onChange({ order })}
                className={[settingsControlClass, "font-mono tabular-nums"].join(" ")}
              />
            </SettingsField>
            <SwitchRow
              id={hiddenId}
              checked={draft.hidden || hiddenLocked}
              disabled={hiddenLocked}
              onChange={(hidden) => onChange({ hidden })}
              label={t("modal.settings.field.vault.hidden")}
              hint={
                hiddenLocked
                  ? t("modal.settings.field.vault.hidden_locked_by_group")
                  : t("modal.settings.field.vault.hidden_help")
              }
            />
          </SettingsFormGrid>
        </SettingsLockedFields>
      </VaultSettingsSection>

      <VaultSettingsSection title={t("modal.settings.section.storage")}>
        <SettingsLockedFields draft={draft}>
          <VaultSettingsStorageSection
            config={draft.storage}
            onChange={(patch) => onChange({ storage: { ...draft.storage, ...patch } })}
          />
        </SettingsLockedFields>
        <FieldErrors errors={createVaultErrorsForField(errors, "storage")} />
      </VaultSettingsSection>

      <VaultSettingsSection title={t("modal.settings.section.mount")}>
        <SettingsLockedFields draft={draft}>
          <VaultSettingsMountSection
            config={draft.mount}
            vaultRootPath={vaultRootPath}
            plaintext={draft.storage.mode === "upriv_plain"}
            appWorkspace={appWorkspace}
            onDriverAttentionChange={onDriverAttentionChange}
            onChange={(patch) => onChange({ mount: { ...draft.mount, ...patch } })}
          />
        </SettingsLockedFields>
        <FieldErrors errors={createVaultErrorsForField(errors, "mount")} />
      </VaultSettingsSection>
    </div>
  );
}
