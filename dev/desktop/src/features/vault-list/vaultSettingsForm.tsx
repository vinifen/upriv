import { useId, type ReactNode } from "react";
import { Button } from "@/components/ui";
import {
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  VAULT_NOTE_MAX_LENGTH,
  VAULT_PASSWORD_HINT_MAX_LENGTH,
} from "@/constants/vault";
import { useTranslation } from "@/i18n";
import { VaultChangePasswordPanel } from "./VaultChangePasswordPanel";
import type { EncryptedDirSecurityUiMode, VaultSettingsConfig } from "./vaultSettingsTypes";
import {
  encryptedDirSecurityModeToUi,
  uiToEncryptedDirSecurityMode,
} from "./vaultSettingsTypes";

export const settingsControlClass =
  "w-full rounded-lg border-0 bg-surface-container-highest px-2.5 py-2 text-sm text-on-surface outline-none ring-0 focus:ring-2 focus:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-60 sm:px-3 sm:py-2.5";

interface SettingsFieldProps {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}

export function SettingsField({ label, hint, htmlFor, children }: SettingsFieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-on-surface">
        {label}
      </label>
      {hint ? <p className="text-xs leading-relaxed text-on-surface-variant">{hint}</p> : null}
      {children}
    </div>
  );
}

interface SettingsFormGridProps {
  children: ReactNode;
}

export function SettingsFormGrid({ children }: SettingsFormGridProps) {
  return <div className="space-y-3 sm:space-y-4">{children}</div>;
}

interface VaultSettingsVaultSectionProps {
  config: VaultSettingsConfig["vault"];
  onChange: (patch: Partial<VaultSettingsConfig["vault"]>) => void;
}

export function VaultSettingsVaultSection({ config, onChange }: VaultSettingsVaultSectionProps) {
  const { t } = useTranslation();
  const displayNameId = useId();
  const orderId = useId();
  const noteId = useId();

  return (
    <SettingsFormGrid>
      <SettingsField
        label={t("modal.settings.field.vault.display_name")}
        htmlFor={displayNameId}
      >
        <input
          id={displayNameId}
          type="text"
          value={config.display_name}
          maxLength={VAULT_DISPLAY_NAME_MAX_LENGTH}
          onChange={(e) => onChange({ display_name: e.target.value })}
          className={settingsControlClass}
        />
      </SettingsField>
      <SettingsField label={t("modal.settings.field.vault.order")} hint={t("modal.settings.field.vault.order_help")} htmlFor={orderId}>
        <input
          id={orderId}
          type="number"
          min={0}
          step={1}
          value={config.order}
          onChange={(e) => onChange({ order: Math.max(0, Number.parseInt(e.target.value, 10) || 0) })}
          className={[settingsControlClass, "font-mono tabular-nums"].join(" ")}
        />
      </SettingsField>
      <SettingsField label={t("modal.settings.note")} htmlFor={noteId} hint={t("modal.settings.field.vault.note_help", { max: VAULT_NOTE_MAX_LENGTH })}>
        <textarea
          id={noteId}
          value={config.note}
          maxLength={VAULT_NOTE_MAX_LENGTH}
          rows={3}
          onChange={(e) => onChange({ note: e.target.value })}
          className={[settingsControlClass, "resize-y"].join(" ")}
        />
      </SettingsField>
    </SettingsFormGrid>
  );
}

interface SectionPatchProps<S extends keyof VaultSettingsConfig> {
  config: VaultSettingsConfig[S];
  onChange: (patch: Partial<VaultSettingsConfig[S]>) => void;
}

export function VaultSettingsStorageSection({ config, onChange }: SectionPatchProps<"storage">) {
  const { t } = useTranslation();
  const storageModeGroup = useId();

  return (
    <SettingsFormGrid>
      <p className="text-xs leading-relaxed text-on-surface-variant">{t("modal.settings.section.storage_intro")}</p>

      <SettingsField
        label={t("modal.settings.field.storage.mode")}
        hint={t("modal.settings.field.storage.mode_help")}
      >
        <div
          role="radiogroup"
          aria-label={t("modal.settings.field.storage.mode")}
          className="grid gap-2"
        >
          <PolicyRadioOption
            groupName={storageModeGroup}
            value="encrypted_dir"
            checked={config.mode === "encrypted_dir"}
            title={t("modal.settings.option.storage.encrypted_dir")}
            description={t("modal.settings.option.storage.encrypted_dir_desc")}
            badge="recommended"
            onSelect={() => onChange({ mode: "encrypted_dir" })}
          />
          <PolicyRadioOption
            groupName={storageModeGroup}
            value="plain"
            checked={config.mode === "plain"}
            title={t("modal.settings.option.storage.plain")}
            description={t("modal.settings.option.storage.plain_desc")}
            badge="less-secure"
            tone="less-secure"
            onSelect={() => onChange({ mode: "plain" })}
          />
        </div>
      </SettingsField>
    </SettingsFormGrid>
  );
}

interface VaultSettingsCloseSectionProps {
  close: VaultSettingsConfig["close"];
  autoClose: VaultSettingsConfig["auto_close"];
  secureWipe: boolean;
  requireUnmountOnSleep: boolean;
  onCloseChange: (patch: Partial<VaultSettingsConfig["close"]>) => void;
  onAutoCloseChange: (patch: Partial<VaultSettingsConfig["auto_close"]>) => void;
  onSecureWipeChange: (secureWipe: boolean) => void;
  onRequireUnmountOnSleepChange: (requireUnmountOnSleep: boolean) => void;
}

export function VaultSettingsCloseSection({
  close,
  autoClose,
  secureWipe,
  requireUnmountOnSleep,
  onCloseChange,
  onAutoCloseChange,
  onSecureWipeChange,
  onRequireUnmountOnSleepChange,
}: VaultSettingsCloseSectionProps) {
  const { t } = useTranslation();
  const lockActionGroup = useId();
  const enabledId = useId();
  const idleId = useId();
  const warnId = useId();
  const exitId = useId();
  const sleepId = useId();
  const wipeId = useId();

  return (
    <SettingsFormGrid>
      <SettingsField
        label={t("modal.settings.field.close.default_action")}
        hint={t("modal.settings.field.close.default_action_help")}
      >
        <div
          role="radiogroup"
          aria-label={t("modal.settings.field.close.default_action")}
          className="grid gap-2"
        >
          <PolicyRadioOption
            groupName={lockActionGroup}
            value="close"
            checked={close.default_action === "close"}
            title={t("modal.settings.option.close.close")}
            description={t("modal.settings.option.close.close_desc")}
            badge="recommended"
            onSelect={() => onCloseChange({ default_action: "close" })}
          />
          <PolicyRadioOption
            groupName={lockActionGroup}
            value="seal"
            checked={close.default_action === "seal"}
            title={t("modal.settings.option.close.seal")}
            description={t("modal.settings.option.close.seal_desc")}
            onSelect={() => onCloseChange({ default_action: "seal" })}
          />
        </div>
      </SettingsField>

      <label className="flex cursor-pointer select-none items-center gap-3">
        <input
          id={wipeId}
          type="checkbox"
          checked={secureWipe}
          onChange={(e) => onSecureWipeChange(e.target.checked)}
          className="h-4 w-4 rounded border-outline-variant/50 text-accent focus:ring-accent/50"
        />
        <span className="text-sm text-on-surface">{t("modal.settings.field.close.secure_wipe")}</span>
      </label>
      {!secureWipe ? (
        <p className="text-xs text-on-error-container/90">{t("modal.settings.field.close.secure_wipe_warn")}</p>
      ) : null}

      <label className="flex cursor-pointer select-none items-center gap-3">
        <input
          id={enabledId}
          type="checkbox"
          checked={autoClose.enabled}
          onChange={(e) => onAutoCloseChange({ enabled: e.target.checked })}
          className="h-4 w-4 rounded border-outline-variant/50 text-accent focus:ring-accent/50"
        />
        <span className="text-sm text-on-surface">{t("modal.settings.field.auto_close.enabled")}</span>
      </label>
      {autoClose.enabled ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsField label={t("modal.settings.field.auto_close.idle_minutes")} htmlFor={idleId}>
            <input
              id={idleId}
              type="number"
              min={1}
              max={1440}
              value={autoClose.idle_minutes}
              onChange={(e) =>
                onAutoCloseChange({
                  idle_minutes: Math.min(1440, Math.max(1, Number.parseInt(e.target.value, 10) || 1)),
                })
              }
              className={[settingsControlClass, "font-mono tabular-nums"].join(" ")}
            />
          </SettingsField>
          <SettingsField label={t("modal.settings.field.auto_close.warn_before_seconds")} htmlFor={warnId}>
            <input
              id={warnId}
              type="number"
              min={0}
              max={300}
              value={autoClose.warn_before_seconds}
              onChange={(e) =>
                onAutoCloseChange({
                  warn_before_seconds: Math.min(300, Math.max(0, Number.parseInt(e.target.value, 10) || 0)),
                })
              }
              className={[settingsControlClass, "font-mono tabular-nums"].join(" ")}
            />
          </SettingsField>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <label className="flex cursor-pointer select-none items-center gap-3">
          <input
            id={exitId}
            type="checkbox"
            checked={autoClose.close_on_app_exit}
            onChange={(e) => onAutoCloseChange({ close_on_app_exit: e.target.checked })}
            className="h-4 w-4 rounded border-outline-variant/50 text-accent focus:ring-accent/50"
          />
          <span className="text-sm text-on-surface">{t("modal.settings.field.auto_close.close_on_app_exit")}</span>
        </label>
        <p className="pl-7 text-xs leading-relaxed text-on-surface-variant">
          {t("modal.settings.field.auto_close.close_on_app_exit_help")}
        </p>
      </div>
      <div className="space-y-1.5">
        <label className="flex cursor-pointer select-none items-center gap-3">
          <input
            id={sleepId}
            type="checkbox"
            checked={requireUnmountOnSleep}
            onChange={(e) => onRequireUnmountOnSleepChange(e.target.checked)}
            className="h-4 w-4 rounded border-outline-variant/50 text-accent focus:ring-accent/50"
          />
          <span className="text-sm text-on-surface">{t("modal.settings.field.close.require_unmount_on_sleep")}</span>
        </label>
        <p className="pl-7 text-xs leading-relaxed text-on-surface-variant">
          {t("modal.settings.field.close.require_unmount_on_sleep_help")}
        </p>
      </div>
    </SettingsFormGrid>
  );
}

export function VaultSettingsBackupSection({ config, onChange }: SectionPatchProps<"backup">) {
  const { t } = useTranslation();
  const modeId = useId();
  const keepId = useId();
  const enabledId = useId();

  return (
    <SettingsFormGrid>
      <label className="flex cursor-pointer select-none items-center gap-3">
        <input
          id={enabledId}
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          className="h-4 w-4 rounded border-outline-variant/50 text-accent focus:ring-accent/50"
        />
        <span className="text-sm text-on-surface">{t("modal.settings.field.backup.enabled")}</span>
      </label>
      <SettingsField label={t("modal.settings.field.backup.mode")} htmlFor={modeId}>
        <select
          id={modeId}
          value={config.mode}
          disabled={!config.enabled}
          onChange={(e) => onChange({ mode: e.target.value as VaultSettingsConfig["backup"]["mode"] })}
          className={settingsControlClass}
        >
          <option value="keep_last">{t("modal.settings.option.backup.keep_last")}</option>
          <option value="keep_all">{t("modal.settings.option.backup.keep_all")}</option>
        </select>
      </SettingsField>
      {config.mode === "keep_last" ? (
        <SettingsField label={t("modal.settings.field.backup.keep_last")} htmlFor={keepId}>
          <input
            id={keepId}
            type="number"
            min={1}
            max={99}
            disabled={!config.enabled}
            value={config.keep_last}
            onChange={(e) =>
              onChange({ keep_last: Math.min(99, Math.max(1, Number.parseInt(e.target.value, 10) || 1)) })
            }
            className={[settingsControlClass, "font-mono tabular-nums"].join(" ")}
          />
        </SettingsField>
      ) : null}
    </SettingsFormGrid>
  );
}

interface VaultSettingsSecuritySectionProps extends SectionPatchProps<"security"> {
  storageMode: VaultSettingsConfig["storage"]["mode"];
  passwordHint: string;
  onPasswordHintChange: (passwordHint: string) => void;
}

const ENCRYPTED_DIR_SECURITY_UI_MODES: EncryptedDirSecurityUiMode[] = ["session_ram", "prompt_open_close"];

const PLAIN_SECURITY_MODES = ["disk_open_close", "disk_close"] as const;

export function VaultSettingsSecuritySection({
  config,
  onChange,
  storageMode,
  passwordHint,
  onPasswordHintChange,
}: VaultSettingsSecuritySectionProps) {
  const { t } = useTranslation();
  const hintId = useId();
  const passwordMemoryGroup = useId();
  const passwordMemoryUiMode = encryptedDirSecurityModeToUi(config.mode);

  return (
    <SettingsFormGrid>
      <SettingsField
        label={t("modal.settings.password_hint")}
        htmlFor={hintId}
        hint={t("modal.settings.field.security.password_hint_help")}
      >
        <input
          id={hintId}
          type="text"
          value={passwordHint}
          maxLength={VAULT_PASSWORD_HINT_MAX_LENGTH}
          onChange={(e) => onPasswordHintChange(e.target.value)}
          className={settingsControlClass}
          autoComplete="off"
        />
      </SettingsField>
      <SettingsField
        label={t("modal.settings.field.security.mode")}
        hint={t("modal.settings.field.security.mode_help")}
      >
        <div
          role="radiogroup"
          aria-label={t("modal.settings.field.security.mode")}
          className="grid gap-2"
        >
          {storageMode === "plain"
            ? PLAIN_SECURITY_MODES.map((mode) => (
                <PolicyRadioOption
                  key={mode}
                  groupName={passwordMemoryGroup}
                  value={mode}
                  checked={config.mode === mode}
                  title={t(`modal.settings.option.security.${mode}`)}
                  description={t(`modal.settings.option.security.${mode}_desc`)}
                  badge={mode === "disk_open_close" ? "less-secure" : undefined}
                  tone={mode === "disk_open_close" ? "less-secure" : "default"}
                  onSelect={() => onChange({ mode })}
                />
              ))
            : ENCRYPTED_DIR_SECURITY_UI_MODES.map((mode) => (
                <PolicyRadioOption
                  key={mode}
                  groupName={passwordMemoryGroup}
                  value={mode}
                  checked={passwordMemoryUiMode === mode}
                  title={t(`modal.settings.option.security.${mode}`)}
                  description={t(`modal.settings.option.security.${mode}_desc`)}
                  badge={mode === "session_ram" ? "recommended" : undefined}
                  onSelect={() => onChange({ mode: uiToEncryptedDirSecurityMode(mode) })}
                />
              ))}
        </div>
      </SettingsField>
      <VaultChangePasswordPanel />
    </SettingsFormGrid>
  );
}

export function VaultSettingsSevenZipSection({ config, onChange }: SectionPatchProps<"seven_zip">) {
  const { t } = useTranslation();
  const archiveModeGroup = useId();
  const encryptId = useId();

  return (
    <SettingsFormGrid>
      <p className="text-xs leading-relaxed text-on-surface-variant">{t("modal.settings.section.seven_zip_intro")}</p>

      <SettingsField
        label={t("modal.settings.field.seven_zip.archive_mode")}
        hint={t("modal.settings.field.seven_zip.archive_mode_help")}
      >
        <div
          role="radiogroup"
          aria-label={t("modal.settings.field.seven_zip.archive_mode")}
          className="grid gap-2"
        >
          <PolicyRadioOption
            groupName={archiveModeGroup}
            value="encrypt_only"
            checked={config.archive_mode === "encrypt_only"}
            title={t("modal.settings.option.seven_zip.encrypt_only")}
            description={t("modal.settings.option.seven_zip.encrypt_only_desc")}
            badge="recommended"
            onSelect={() => onChange({ archive_mode: "encrypt_only" })}
          />
          <PolicyRadioOption
            groupName={archiveModeGroup}
            value="compress_encrypt"
            checked={config.archive_mode === "compress_encrypt"}
            title={t("modal.settings.option.seven_zip.compress_encrypt")}
            description={t("modal.settings.option.seven_zip.compress_encrypt_desc")}
            onSelect={() => onChange({ archive_mode: "compress_encrypt" })}
          />
        </div>
      </SettingsField>

      <SettingsField
        label={t("modal.settings.field.seven_zip.encrypt_file_names")}
        hint={t("modal.settings.field.seven_zip.encrypt_file_names_help")}
        htmlFor={encryptId}
      >
        <label className="flex cursor-pointer select-none items-center gap-3">
          <input
            id={encryptId}
            type="checkbox"
            checked={config.encrypt_file_names}
            onChange={(e) => onChange({ encrypt_file_names: e.target.checked })}
            className="h-4 w-4 rounded border-outline-variant/50 text-accent focus:ring-accent/50"
          />
          <span className="text-sm text-on-surface">{t("modal.settings.field.seven_zip.encrypt_file_names_label")}</span>
        </label>
        {!config.encrypt_file_names ? (
          <p className="text-xs text-on-error-container/90">{t("modal.settings.field.seven_zip.encrypt_file_names_off_warn")}</p>
        ) : null}
      </SettingsField>
    </SettingsFormGrid>
  );
}

export function VaultSettingsPolicySection({ config, onChange }: SectionPatchProps<"policy">) {
  const { t } = useTranslation();
  const editorsGroup = useId();
  const copyGroup = useId();
  const externalBlockCopy = config.allow_external_editors && config.disallow_copy_outside_mount;

  return (
    <SettingsFormGrid>
      <SettingsField
        label={t("modal.settings.field.policy.external_editors")}
        hint={t("modal.settings.field.policy.external_editors_help")}
      >
        <div
          role="radiogroup"
          aria-label={t("modal.settings.field.policy.external_editors")}
          className="grid gap-2"
        >
          <PolicyRadioOption
            groupName={editorsGroup}
            value="false"
            checked={!config.allow_external_editors}
            title={t("modal.settings.option.policy.external_editors_no")}
            description={t("modal.settings.option.policy.external_editors_no_desc")}
            badge="recommended"
            onSelect={() => onChange({ allow_external_editors: false })}
          />
          <PolicyRadioOption
            groupName={editorsGroup}
            value="true"
            checked={config.allow_external_editors}
            title={t("modal.settings.option.policy.external_editors_yes")}
            description={t("modal.settings.option.policy.external_editors_yes_desc")}
            badge="less-secure"
            tone="less-secure"
            onSelect={() => onChange({ allow_external_editors: true })}
          />
        </div>
      </SettingsField>

      <SettingsField
        label={t("modal.settings.field.policy.copy_outside")}
        hint={t("modal.settings.field.policy.copy_outside_help")}
      >
        <div
          role="radiogroup"
          aria-label={t("modal.settings.field.policy.copy_outside")}
          className="grid gap-2"
        >
          <PolicyRadioOption
            groupName={copyGroup}
            value="block"
            checked={config.disallow_copy_outside_mount}
            title={t("modal.settings.option.policy.copy_block")}
            description={t("modal.settings.option.policy.copy_block_desc")}
            badge="recommended"
            onSelect={() => onChange({ disallow_copy_outside_mount: true })}
          />
          <PolicyRadioOption
            groupName={copyGroup}
            value="allow"
            checked={!config.disallow_copy_outside_mount}
            title={t("modal.settings.option.policy.copy_allow")}
            description={t("modal.settings.option.policy.copy_allow_desc")}
            badge="less-secure"
            tone="less-secure"
            onSelect={() => onChange({ disallow_copy_outside_mount: false })}
          />
        </div>
      </SettingsField>

      {config.allow_external_editors ? (
        <p className="text-xs leading-relaxed text-on-error-container">{t("warning.external_editor")}</p>
      ) : null}
      {externalBlockCopy ? (
        <p className="text-xs leading-relaxed text-on-surface-variant">
          {t("warning.policy.external_block_copy")}
        </p>
      ) : null}
    </SettingsFormGrid>
  );
}

interface PolicyRadioOptionProps {
  groupName: string;
  value: string;
  checked: boolean;
  title: string;
  description: string;
  badge?: "recommended" | "less-secure" | "default";
  tone?: "default" | "less-secure";
  /** Shown below the description while this option is selected. */
  footer?: ReactNode;
  onSelect: () => void;
}

export function PolicyRadioOption({
  groupName,
  value,
  checked,
  title,
  description,
  badge,
  tone = "default",
  footer,
  onSelect,
}: PolicyRadioOptionProps) {
  const { t } = useTranslation();
  const inputId = useId();

  return (
    <label
      htmlFor={inputId}
      className={[
        "block cursor-pointer select-none rounded-lg bg-surface-container p-2.5 transition-colors sm:p-3",
        checked ? "ring-2 ring-accent/50" : "ring-1 ring-outline-variant/25 hover:ring-outline-variant/40",
        tone === "less-secure" && !checked ? "ring-on-error-container/20" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="flex gap-2.5 sm:gap-3">
        <input
          id={inputId}
          type="radio"
          name={groupName}
          value={value}
          checked={checked}
          onChange={onSelect}
          className="mt-0.5 h-4 w-4 shrink-0 border-outline-variant/50 text-accent focus:ring-accent/50"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span
              className={[
                "text-sm font-medium leading-snug",
                tone === "less-secure" ? "text-on-error-container" : "text-on-surface",
              ].join(" ")}
            >
              {title}
            </span>
            {badge === "recommended" ? (
              <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                {t("modal.settings.badge.recommended")}
              </span>
            ) : null}
            {badge === "default" ? (
              <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                {t("modal.settings.badge.default")}
              </span>
            ) : null}
            {badge === "less-secure" ? (
              <span className="rounded-md bg-on-error-container/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-on-error-container">
                {t("modal.settings.badge.less_secure")}
              </span>
            ) : null}
          </span>
          <span className="mt-1.5 block text-xs leading-relaxed text-on-surface-variant">{description}</span>
        </span>
      </span>
      {checked && footer ? (
        <div
          className="mt-3 pl-6 sm:pl-7"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {footer}
        </div>
      ) : null}
    </label>
  );
}

interface VaultSettingsDangerZoneSectionProps {
  vaultId: string;
  deleteOpen: boolean;
  deleteConfirm: string;
  confirmInputId: string;
  canConfirmDelete: boolean;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onConfirmChange: (value: string) => void;
}

export function VaultSettingsDangerZoneSection({
  vaultId,
  deleteOpen,
  deleteConfirm,
  confirmInputId,
  canConfirmDelete,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onConfirmChange,
}: VaultSettingsDangerZoneSectionProps) {
  const { t } = useTranslation();

  if (!deleteOpen) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-on-surface-variant">{t("modal.settings.danger_zone_help")}</p>
        <Button variant="danger" size="sm" onClick={onRequestDelete}>
          {t("modal.settings.delete_vault")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-on-surface-variant">{t("modal.settings.delete_confirm")}</p>
      <p className="font-mono text-xs text-on-surface-variant/80">{vaultId}</p>
      <input
        id={confirmInputId}
        type="text"
        value={deleteConfirm}
        onChange={(event) => onConfirmChange(event.target.value)}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        className={settingsControlClass}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancelDelete}>
          {t("action.cancel")}
        </Button>
        <Button variant="danger" size="sm" disabled={!canConfirmDelete} onClick={onConfirmDelete}>
          {t("action.delete")}
        </Button>
      </div>
    </div>
  );
}
