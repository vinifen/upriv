import { useId } from "react";
import { Button, PasswordInput, SwitchRow } from "@/components/ui";
import {
  createVaultChoosesKdf,
  createVaultErrorsForField,
  createVaultImportNeedsRename,
  importDisplayNameFromFilename,
  isHiddenGroup,
  NO_VAULT_GROUPS,
  normalizeSecurityModeForStorage,
  storageModeIsPlaintext,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  VAULT_NOTE_MAX_LENGTH,
  VAULT_PASSWORD_HINT_MAX_LENGTH,
  type CreateVaultDraft,
  type CreateVaultStepId,
  type CreateVaultValidationCode,
  type VaultGroup,
} from "@upriv/shared";
import type { CreateVaultStepFocusProps } from "@upriv/shared/react";
import { useCreateVaultService } from "@/platform/services";
import { useTranslation } from "@/i18n";
import {
  PolicyRadioOption,
  SecurityModeRadioGroup,
  settingsControlClass,
  SettingsField,
  SettingsFormGrid,
  VaultSettingsBackupSection,
  VaultSettingsGroupSection,
  VaultSettingsKdfSection,
  VaultSettingsMountSection,
  VaultSettingsPolicySection,
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

function CreateVaultSourceStep({ draft, errors, onChange }: StepProps) {
  const { t } = useTranslation();
  const createVaultService = useCreateVaultService();
  const sourceGroup = useId();

  const handleImportFile = () => {
    // Prototype: mock service returns a hardcoded path until a native file picker is wired.
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
    <div className="space-y-2">
      <input
        type="text"
        readOnly
        value={draft.importFileName}
        placeholder={t("vault.create.import_file_placeholder")}
        className={[settingsControlClass, "font-mono text-xs"].join(" ")}
      />
      <Button type="button" variant="secondary" size="md" onClick={handleImportFile}>
        {t("vault.create.action.choose_file")}
      </Button>
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
          groupName={sourceGroup}
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
  onAdvanceStep,
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
              onAdvanceStep?.();
            }
          }}
          onChange={(e) => onChange({ displayName: e.target.value })}
          className={settingsControlClass}
        />
        <FieldErrors errors={createVaultErrorsForField(errors, "displayName")} />
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
  const passwordId = useId();
  const confirmId = useId();
  const hintId = useId();
  const isImport = draft.source === "import";

  return (
    <SettingsFormGrid>
      <p className="text-sm text-on-surface-variant">
        {isImport
          ? t("vault.create.password_import_intro")
          : t("vault.create.password_scratch_intro")}
      </p>
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
              onAdvanceStep?.();
            }
          }}
          onChange={(e) =>
            onChange({
              password: e.target.value,
              passwordValidated: false,
              passwordTestFailed: false,
            })
          }
          inputClassName={settingsControlClass}
        />
        <FieldErrors errors={createVaultErrorsForField(errors, "password")} />
      </SettingsField>
      {!isImport ? (
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
                onAdvanceStep?.();
              }
            }}
            onChange={(e) => onChange({ passwordConfirm: e.target.value })}
            inputClassName={settingsControlClass}
          />
          <FieldErrors errors={createVaultErrorsForField(errors, "passwordConfirm")} />
        </SettingsField>
      ) : (
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
      )}
      <SettingsField
        label={t("vault.create.password_hint")}
        htmlFor={hintId}
        hint={t("vault.create.password_hint_help")}
      >
        <input
          id={hintId}
          ref={bindFieldRef?.("passwordHint")}
          type="text"
          value={draft.passwordHint}
          maxLength={VAULT_PASSWORD_HINT_MAX_LENGTH}
          onFocus={() => onFieldFocus?.("passwordHint")}
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
  const autoCloseId = useId();
  const idleId = useId();
  const warnId = useId();
  return (
    <div className="space-y-1.5 sm:space-y-2">
      <p className="text-sm text-on-surface-variant">{t("vault.create.general_intro")}</p>

      <VaultSettingsSection title={t("modal.settings.section.auto_close")} defaultOpen>
        <SettingsFormGrid>
          <SwitchRow
            id={autoCloseId}
            checked={draft.auto_close.enabled}
            onChange={(enabled) => onChange({ auto_close: { ...draft.auto_close, enabled } })}
            label={t("modal.settings.field.auto_close.enabled")}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SettingsField
              label={t("modal.settings.field.auto_close.idle_minutes")}
              htmlFor={idleId}
              disabled={!draft.auto_close.enabled}
            >
              <input
                id={idleId}
                type="number"
                min={1}
                max={1440}
                value={draft.auto_close.idle_minutes}
                disabled={!draft.auto_close.enabled}
                onChange={(e) =>
                  onChange({
                    auto_close: {
                      ...draft.auto_close,
                      idle_minutes: Math.min(
                        1440,
                        Math.max(1, Number.parseInt(e.target.value, 10) || 1),
                      ),
                    },
                  })
                }
                className={[settingsControlClass, "font-mono tabular-nums"].join(" ")}
              />
            </SettingsField>
            <SettingsField
              label={t("modal.settings.field.auto_close.warn_before_seconds")}
              htmlFor={warnId}
              disabled={!draft.auto_close.enabled}
            >
              <input
                id={warnId}
                type="number"
                min={0}
                max={300}
                value={draft.auto_close.warn_before_seconds}
                disabled={!draft.auto_close.enabled}
                onChange={(e) =>
                  onChange({
                    auto_close: {
                      ...draft.auto_close,
                      warn_before_seconds: Math.min(
                        300,
                        Math.max(0, Number.parseInt(e.target.value, 10) || 0),
                      ),
                    },
                  })
                }
                className={[settingsControlClass, "font-mono tabular-nums"].join(" ")}
              />
            </SettingsField>
          </div>
        </SettingsFormGrid>
      </VaultSettingsSection>

      <VaultSettingsSection title={t("modal.settings.section.backup")} defaultOpen>
        <VaultSettingsBackupSection
          config={draft.backup}
          onChange={(patch) => onChange({ backup: { ...draft.backup, ...patch } })}
        />
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
        <FieldErrors errors={createVaultErrorsForField(errors, "groupName")} />
      </VaultSettingsSection>

      <VaultSettingsSection title={t("modal.settings.section.kdf")} defaultOpen>
        <VaultSettingsKdfSection
          config={draft.kdf}
          choosesPreset={createVaultChoosesKdf(draft)}
          onChange={(patch) => onChange({ kdf: { ...draft.kdf, ...patch } })}
        />
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
}: StepProps) {
  const { t } = useTranslation();
  const orderId = useId();
  const hiddenId = useId();
  const securityGroup = useId();
  const wipeId = useId();
  const sleepId = useId();
  const hiddenLocked = draft.groupMode === "existing" && isHiddenGroup(groups, draft.groupId);

  const setStorageMode = (mode: CreateVaultDraft["storage"]["mode"]) => {
    onChange({
      storage: { mode },
      security: {
        ...draft.security,
        mode: normalizeSecurityModeForStorage(mode, draft.security.mode),
      },
    });
  };

  return (
    <div className="space-y-1.5 sm:space-y-2">
      <p className="text-sm text-on-surface-variant">{t("vault.create.advanced_intro")}</p>
      <p className="text-sm leading-relaxed text-on-surface-variant">
        {t("vault.create.settings_editable_later")}
      </p>

      <VaultSettingsSection title={t("modal.settings.section.vault")}>
        <SettingsFormGrid>
          <SettingsField
            label={t("modal.settings.field.vault.order")}
            hint={t("modal.settings.field.vault.order_help")}
            htmlFor={orderId}
          >
            <input
              id={orderId}
              type="number"
              min={0}
              step={1}
              value={draft.order}
              onChange={(e) =>
                onChange({ order: Math.max(0, Number.parseInt(e.target.value, 10) || 0) })
              }
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
      </VaultSettingsSection>

      <VaultSettingsSection title={t("modal.settings.section.storage")}>
        <VaultSettingsStorageSection
          config={draft.storage}
          onChange={(patch) => {
            if (patch.mode !== undefined) setStorageMode(patch.mode);
          }}
        />
        <FieldErrors errors={createVaultErrorsForField(errors, "storage")} />
      </VaultSettingsSection>

      <VaultSettingsSection title={t("modal.settings.section.mount")}>
        <VaultSettingsMountSection
          config={draft.mount}
          vaultRootPath={vaultRootPath}
          onChange={(patch) => onChange({ mount: { ...draft.mount, ...patch } })}
        />
        <FieldErrors errors={createVaultErrorsForField(errors, "mount")} />
      </VaultSettingsSection>

      <VaultSettingsSection title={t("modal.settings.section.security")}>
        <SettingsFormGrid>
          <SwitchRow
            id={wipeId}
            checked={draft.security.secure_wipe_workspace}
            onChange={(secure_wipe_workspace) =>
              onChange({
                security: { ...draft.security, secure_wipe_workspace },
              })
            }
            label={t("modal.settings.field.close.secure_wipe")}
          />
          <SettingsField
            label={t("modal.settings.field.security.mode")}
            hint={
              storageModeIsPlaintext(draft.storage.mode)
                ? t("modal.settings.field.security.mode_help_plain")
                : t("modal.settings.field.security.mode_help")
            }
          >
            <div role="radiogroup" className="grid gap-2">
              <SecurityModeRadioGroup
                storageMode={draft.storage.mode}
                securityMode={draft.security.mode}
                groupName={securityGroup}
                onSelectMode={(mode) => onChange({ security: { ...draft.security, mode } })}
              />
            </div>
          </SettingsField>
        </SettingsFormGrid>
      </VaultSettingsSection>

      <VaultSettingsSection title={t("modal.settings.section.policy")}>
        <SettingsFormGrid>
          <VaultSettingsPolicySection
            config={draft.policy}
            onChange={(patch) => onChange({ policy: { ...draft.policy, ...patch } })}
          />
          <SwitchRow
            id={sleepId}
            checked={draft.policy.require_unmount_on_sleep}
            onChange={(require_unmount_on_sleep) =>
              onChange({
                policy: { ...draft.policy, require_unmount_on_sleep },
              })
            }
            label={t("modal.settings.field.close.require_unmount_on_sleep")}
            hint={t("modal.settings.field.close.require_unmount_on_sleep_help")}
          />
        </SettingsFormGrid>
      </VaultSettingsSection>
    </div>
  );
}
