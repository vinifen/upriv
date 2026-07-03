import { useId, useRef } from "react";
import { Button, PasswordInput } from "@/components/ui";
import {
  displayNameFromArchiveFilename,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  VAULT_NOTE_MAX_LENGTH,
  VAULT_PASSWORD_HINT_MAX_LENGTH,
} from "@upriv/shared";
import { useCreateVaultService } from "@/platform/services";
import { useTranslation } from "@/i18n";
import {
  PolicyRadioOption,
  SecurityModeRadioGroup,
  settingsControlClass,
  SettingsField,
  SettingsFormGrid,
  VaultSettingsBackupSection,
  VaultSettingsSection,
} from "@/components/settings";
import type {
  CloseDefaultAction,
  CreateVaultDraft,
  CreateVaultStepId,
  CreateVaultValidationCode,
} from "@upriv/shared";
import { transitionStorageModeClose } from "@upriv/shared";
import { createVaultErrorKey } from "./validationMessages";

interface StepProps {
  draft: CreateVaultDraft;
  errors: CreateVaultValidationCode[];
  onChange: (patch: Partial<CreateVaultDraft>) => void;
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
  if (errors.length === 0) return null;

  return (
    <ul className="space-y-1 rounded-lg bg-on-error-container/10 px-3 py-2 text-sm text-on-error-container">
      {errors.map((code) => (
        <li key={code}>
          {t(
            createVaultErrorKey(code),
            code === "too_long" ? { max: VAULT_DISPLAY_NAME_MAX_LENGTH } : undefined,
          )}
        </li>
      ))}
    </ul>
  );
}

function CreateVaultSourceStep({ draft, errors, onChange }: StepProps) {
  const { t } = useTranslation();
  const createVaultService = useCreateVaultService();
  const sourceGroup = useId();

  const handleImportFile = () => {
    // Prototype: mock service returns a fixed path/password until native file picker + 7zz probe.
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
    <div className="space-y-2">
      <input
        type="text"
        readOnly
        value={draft.importFileName}
        placeholder={t("vault.create.import_file_placeholder")}
        className={[settingsControlClass, "font-mono text-xs"].join(" ")}
      />
      <Button type="button" variant="secondary" size="md" onClick={handleImportFile}>
        {t("vault.create.action.choose_archive")}
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
      <StepErrors errors={errors} />
    </SettingsFormGrid>
  );
}

function CreateVaultIdentityStep({ draft, errors, onChange }: StepProps) {
  const { t } = useTranslation();
  const nameId = useId();
  const noteId = useId();

  return (
    <SettingsFormGrid>
      <p className="text-sm text-on-surface-variant">{t("vault.create.identity_intro")}</p>
      <SettingsField label={t("vault.name.label")} htmlFor={nameId}>
        <input
          id={nameId}
          type="text"
          value={draft.displayName}
          maxLength={VAULT_DISPLAY_NAME_MAX_LENGTH}
          onChange={(e) => onChange({ displayName: e.target.value })}
          className={settingsControlClass}
        />
      </SettingsField>
      <SettingsField
        label={t("vault.create.note")}
        htmlFor={noteId}
        hint={t("vault.create.note_help", { max: VAULT_NOTE_MAX_LENGTH })}
      >
        <textarea
          id={noteId}
          value={draft.note}
          maxLength={VAULT_NOTE_MAX_LENGTH}
          rows={3}
          onChange={(e) => onChange({ note: e.target.value })}
          className={[settingsControlClass, "resize-y"].join(" ")}
        />
      </SettingsField>
      <StepErrors errors={errors} />
    </SettingsFormGrid>
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
          value={draft.password}
          autoComplete="new-password"
          onChange={(e) =>
            onChange({
              password: e.target.value,
              passwordValidated: false,
              passwordTestFailed: false,
            })
          }
          inputClassName={settingsControlClass}
        />
      </SettingsField>
      {!isImport ? (
        <SettingsField label={t("vault.create.password_confirm")} htmlFor={confirmId}>
          <PasswordInput
            id={confirmId}
            value={draft.passwordConfirm}
            autoComplete="new-password"
            onChange={(e) => onChange({ passwordConfirm: e.target.value })}
            inputClassName={settingsControlClass}
          />
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
          type="text"
          value={draft.passwordHint}
          maxLength={VAULT_PASSWORD_HINT_MAX_LENGTH}
          onChange={(e) => onChange({ passwordHint: e.target.value })}
          className={settingsControlClass}
        />
      </SettingsField>
      <StepErrors errors={errors} />
    </SettingsFormGrid>
  );
}

function CreateVaultGeneralStep({ draft, onChange }: StepProps) {
  const { t } = useTranslation();
  const autoCloseId = useId();
  const idleId = useId();
  const warnId = useId();
  const archiveGroup = useId();

  return (
    <SettingsFormGrid>
      <p className="text-sm text-on-surface-variant">{t("vault.create.general_intro")}</p>

      <label className="flex cursor-pointer select-none items-center gap-3">
        <input
          id={autoCloseId}
          type="checkbox"
          checked={draft.auto_close.enabled}
          onChange={(e) =>
            onChange({ auto_close: { ...draft.auto_close, enabled: e.target.checked } })
          }
          className="h-4 w-4 rounded border-outline-variant/50 text-accent focus:ring-accent/50"
        />
        <span className="text-sm text-on-surface">
          {t("modal.settings.field.auto_close.enabled")}
        </span>
      </label>
      {draft.storage.mode === "plain" && draft.auto_close.enabled ? (
        <p className="text-xs leading-relaxed text-on-surface-variant">
          {t("modal.settings.field.auto_close.plain_seals")}
        </p>
      ) : null}
      {draft.auto_close.enabled ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsField label={t("modal.settings.field.auto_close.idle_minutes")} htmlFor={idleId}>
            <input
              id={idleId}
              type="number"
              min={1}
              max={1440}
              value={draft.auto_close.idle_minutes}
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
          >
            <input
              id={warnId}
              type="number"
              min={0}
              max={300}
              value={draft.auto_close.warn_before_seconds}
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
      ) : null}

      <VaultSettingsBackupSection
        config={draft.backup}
        onChange={(patch) => onChange({ backup: { ...draft.backup, ...patch } })}
      />

      <SettingsField
        label={t("modal.settings.field.seven_zip.archive_mode")}
        hint={t("modal.settings.field.seven_zip.archive_mode_help")}
      >
        <div role="radiogroup" className="grid gap-2">
          <PolicyRadioOption
            groupName={archiveGroup}
            value="encrypt_only"
            checked={draft.seven_zip.archive_mode === "encrypt_only"}
            title={t("modal.settings.option.seven_zip.encrypt_only")}
            description={t("modal.settings.option.seven_zip.encrypt_only_desc")}
            badge="default"
            onSelect={() =>
              onChange({ seven_zip: { ...draft.seven_zip, archive_mode: "encrypt_only" } })
            }
          />
          <PolicyRadioOption
            groupName={archiveGroup}
            value="compress_encrypt"
            checked={draft.seven_zip.archive_mode === "compress_encrypt"}
            title={t("modal.settings.option.seven_zip.compress_encrypt")}
            description={t("modal.settings.option.seven_zip.compress_encrypt_desc")}
            onSelect={() =>
              onChange({ seven_zip: { ...draft.seven_zip, archive_mode: "compress_encrypt" } })
            }
          />
        </div>
      </SettingsField>
    </SettingsFormGrid>
  );
}

function CreateVaultAdvancedStep({ draft, onChange }: StepProps) {
  const { t } = useTranslation();
  const orderId = useId();
  const hiddenId = useId();
  const storageGroup = useId();
  const securityGroup = useId();
  const closeGroup = useId();
  const editorsGroup = useId();
  const copyGroup = useId();
  const wipeId = useId();
  const encryptNamesId = useId();
  const sleepId = useId();
  const encryptedCloseRef = useRef<CloseDefaultAction>(draft.close.default_action);

  const setStorageMode = (mode: CreateVaultDraft["storage"]["mode"]) => {
    const { close, encryptedClosePreference } = transitionStorageModeClose(
      draft.storage.mode,
      draft.close.default_action,
      mode,
      encryptedCloseRef.current,
    );
    encryptedCloseRef.current = encryptedClosePreference;
    onChange({ storage: { mode }, close: { default_action: close } });
  };

  const setCloseDefault = (defaultAction: CloseDefaultAction) => {
    if (draft.storage.mode === "encrypted_dir") {
      encryptedCloseRef.current = defaultAction;
    }
    onChange({ close: { default_action: defaultAction } });
  };

  return (
    <SettingsFormGrid>
      <p className="text-sm text-on-surface-variant">{t("vault.create.advanced_intro")}</p>
      <p className="text-sm leading-relaxed text-on-surface-variant">
        {t("vault.create.settings_editable_later")}
      </p>
      <VaultSettingsSection title={t("vault.create.advanced_section")} defaultOpen={false}>
        <div className="space-y-4">
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

          <div className="space-y-1.5">
            <label className="flex cursor-pointer select-none items-center gap-3">
              <input
                id={hiddenId}
                type="checkbox"
                checked={draft.hidden}
                onChange={(e) => onChange({ hidden: e.target.checked })}
                className="h-4 w-4 rounded border-outline-variant/50 text-accent focus:ring-accent/50"
              />
              <span className="text-sm text-on-surface">
                {t("modal.settings.field.vault.hidden")}
              </span>
            </label>
            <p className="pl-7 text-xs leading-relaxed text-on-surface-variant">
              {t("modal.settings.field.vault.hidden_help")}
            </p>
          </div>

          <SettingsField
            label={t("modal.settings.field.storage.mode")}
            hint={t("modal.settings.field.storage.mode_help")}
          >
            <div role="radiogroup" className="grid gap-2">
              <PolicyRadioOption
                groupName={storageGroup}
                value="encrypted_dir"
                checked={draft.storage.mode === "encrypted_dir"}
                title={t("modal.settings.option.storage.encrypted_dir")}
                description={t("modal.settings.option.storage.encrypted_dir_desc")}
                badge="recommended"
                onSelect={() => setStorageMode("encrypted_dir")}
              />
              <PolicyRadioOption
                groupName={storageGroup}
                value="plain"
                checked={draft.storage.mode === "plain"}
                title={t("modal.settings.option.storage.plain")}
                description={t("modal.settings.option.storage.plain_desc")}
                badge="insecure"
                tone="insecure"
                onSelect={() => setStorageMode("plain")}
              />
            </div>
          </SettingsField>
          {draft.storage.mode === "encrypted_dir" ? (
            <p className="text-xs leading-relaxed text-on-error-container/90">
              {t("warning.encrypted_dir_ram")}
            </p>
          ) : null}
          {draft.storage.mode === "plain" ? (
            <p className="text-xs font-medium text-on-error-container">{t("warning.plain_mode")}</p>
          ) : null}

          {draft.storage.mode === "plain" ? (
            <p className="text-xs leading-relaxed text-on-surface-variant">
              {t("modal.settings.field.close.plain_seal_only")}
            </p>
          ) : (
            <SettingsField
              label={t("modal.settings.field.close.default_action")}
              hint={t("modal.settings.field.close.default_action_help")}
            >
              <div role="radiogroup" className="grid gap-2">
                <PolicyRadioOption
                  groupName={closeGroup}
                  value="close"
                  checked={draft.close.default_action === "close"}
                  title={t("modal.settings.option.close.close")}
                  description={t("modal.settings.option.close.close_desc")}
                  badge="default"
                  onSelect={() => setCloseDefault("close")}
                />
                <PolicyRadioOption
                  groupName={closeGroup}
                  value="seal"
                  checked={draft.close.default_action === "seal"}
                  title={t("modal.settings.option.close.seal")}
                  description={t("modal.settings.option.close.seal_desc")}
                  onSelect={() => setCloseDefault("seal")}
                />
              </div>
            </SettingsField>
          )}

          <label className="flex cursor-pointer select-none items-center gap-3">
            <input
              id={wipeId}
              type="checkbox"
              checked={draft.security.secure_wipe_workspace}
              onChange={(e) =>
                onChange({
                  security: { ...draft.security, secure_wipe_workspace: e.target.checked },
                })
              }
              className="h-4 w-4 rounded border-outline-variant/50 text-accent focus:ring-accent/50"
            />
            <span className="text-sm text-on-surface">
              {t("modal.settings.field.close.secure_wipe")}
            </span>
          </label>

          <SettingsField
            label={t("modal.settings.field.security.mode")}
            hint={
              draft.storage.mode === "plain"
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

          <SettingsField
            label={t("modal.settings.field.policy.external_editors")}
            hint={t("modal.settings.field.policy.external_editors_help")}
          >
            <div role="radiogroup" className="grid gap-2">
              <PolicyRadioOption
                groupName={editorsGroup}
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
                groupName={editorsGroup}
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
            </div>
          </SettingsField>

          <SettingsField
            label={t("modal.settings.field.policy.copy_outside")}
            hint={t("modal.settings.field.policy.copy_outside_help")}
          >
            <div role="radiogroup" className="grid gap-2">
              <PolicyRadioOption
                groupName={copyGroup}
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
                groupName={copyGroup}
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
            </div>
          </SettingsField>

          <label className="flex cursor-pointer select-none items-center gap-3">
            <input
              id={encryptNamesId}
              type="checkbox"
              checked={draft.seven_zip.encrypt_file_names}
              onChange={(e) =>
                onChange({
                  seven_zip: { ...draft.seven_zip, encrypt_file_names: e.target.checked },
                })
              }
              className="h-4 w-4 rounded border-outline-variant/50 text-accent focus:ring-accent/50"
            />
            <span className="text-sm text-on-surface">
              {t("modal.settings.field.seven_zip.encrypt_file_names_label")}
            </span>
          </label>
          {!draft.seven_zip.encrypt_file_names ? (
            <p className="text-xs text-on-error-container/90">
              {t("modal.settings.field.seven_zip.encrypt_file_names_off_warn")}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <label className="flex cursor-pointer select-none items-center gap-3">
              <input
                id={sleepId}
                type="checkbox"
                checked={draft.policy.require_unmount_on_sleep}
                onChange={(e) =>
                  onChange({
                    policy: { ...draft.policy, require_unmount_on_sleep: e.target.checked },
                  })
                }
                className="h-4 w-4 rounded border-outline-variant/50 text-accent focus:ring-accent/50"
              />
              <span className="text-sm text-on-surface">
                {t("modal.settings.field.close.require_unmount_on_sleep")}
              </span>
            </label>
            <p className="pl-7 text-xs leading-relaxed text-on-surface-variant">
              {t("modal.settings.field.close.require_unmount_on_sleep_help")}
            </p>
          </div>
        </div>
      </VaultSettingsSection>
    </SettingsFormGrid>
  );
}
