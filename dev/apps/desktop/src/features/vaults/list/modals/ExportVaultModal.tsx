import { useEffect, useId, useRef, useState, type RefObject } from "react";
import {
  Button,
  JobProgressBar,
  LoadingBudgetHint,
  Modal,
  PasswordInput,
  SwitchRow,
} from "@/components/ui";
import {
  PolicyRadioOption,
  SettingsField,
  settingsControlClass,
  settingsInvalidControlClass,
  VaultSettingsSevenZipSection,
} from "@/components/settings";
import { ExportFolderField } from "@/components/ExportFolderField";
import { useLoadingBudget } from "@upriv/shared/react";
import { useTranslation } from "@/i18n";
import { useVaultService } from "@/platform/services";
import { useErrorToast } from "@/hooks/useErrorToast";
import {
  DEFAULT_SEVEN_ZIP,
  DEFAULT_VAULT_EXPORT_FORMAT,
  DEFAULT_VAULT_EXPORT_INCLUDE,
  LOADING_BUDGET_MS,
  VAULT_EXPORT_PROGRESS_COPY,
  exportFilenameSanitizeKind,
  vaultExportFilename,
  vaultExportPending,
  type VaultExportFormat,
  type VaultExportInclude,
  type VaultExportPasswordFormat,
  type VaultExportRequest,
  type VaultExportRun,
  type VaultListItem,
  type VaultSettingsConfig,
} from "@upriv/shared";
import type { VaultExportFolders } from "../hooks/useVaultExportFolders";

const NO_PASSWORDS: Record<VaultExportPasswordFormat, string> = { seven_zip: "", plain_zip: "" };

const DEFAULT_INCLUDES: Record<VaultExportPasswordFormat, VaultExportInclude> = {
  seven_zip: DEFAULT_VAULT_EXPORT_INCLUDE,
  plain_zip: DEFAULT_VAULT_EXPORT_INCLUDE,
};

interface ExportPasswordFieldProps {
  inputRef: RefObject<HTMLInputElement>;
  hint: string;
  value: string;
  error: string | null;
  disabled: boolean;
  onChange: (value: string) => void;
  onEnter: () => void;
}

/** The vault password an option that decrypts the vault asks for. */
function ExportPasswordField({
  inputRef,
  hint,
  value,
  error,
  disabled,
  onChange,
  onEnter,
}: ExportPasswordFieldProps) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <SettingsField label={t("vault.export.dialog.vault_password")} hint={hint} htmlFor={id}>
      <PasswordInput
        ref={inputRef}
        id={id}
        value={value}
        autoComplete="current-password"
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-errormessage={error ? `${id}-error` : undefined}
        inputClassName={[settingsControlClass, settingsInvalidControlClass].join(" ")}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          onEnter();
        }}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-on-error-container">
          {error}
        </p>
      ) : null}
    </SettingsField>
  );
}

interface ExportIncludeSwitchesProps {
  include: VaultExportInclude;
  disabled: boolean;
  onChange: (include: VaultExportInclude) => void;
}

/** What `.upriv-config/` carries beside the vault's files. */
function ExportIncludeSwitches({ include, disabled, onChange }: ExportIncludeSwitchesProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <SwitchRow
        checked={include.workspace}
        disabled={disabled}
        label={t("vault.export.dialog.include_workspace")}
        hint={t("vault.export.dialog.include_workspace_hint")}
        onChange={(workspace) => onChange({ ...include, workspace })}
      />
      <SwitchRow
        checked={include.settings}
        disabled={disabled}
        label={t("vault.export.dialog.include_settings")}
        hint={t("vault.export.dialog.include_settings_hint")}
        onChange={(settings) => onChange({ ...include, settings })}
      />
    </div>
  );
}

interface ExportVaultModalProps {
  vault: VaultListItem | null;
  open: boolean;
  /**
   * This vault's export in flight. The options are locked, and the one being
   * written shows how far it got in place of its fields.
   */
  running?: VaultExportRun | null;
  /** Why the last export refused its password (wrong, or the unlock limit). */
  passwordError?: string | null;
  /** Each format's folder, kept by the vault list for the next export. */
  folders: VaultExportFolders;
  onClose: () => void;
  /** Export into `destDir`, the chosen format's folder. */
  onConfirm: (request: VaultExportRequest, destDir: string) => void;
  /** Ask the running export to stop (`job_cancel`); core removes its unfinished file. */
  onStop: () => void;
  /** The password changed, so its refusal no longer applies. */
  onPasswordEdited?: () => void;
  onTimeout?: () => void;
}

export function ExportVaultModal({
  vault,
  open,
  running = null,
  passwordError = null,
  folders,
  onClose,
  onConfirm,
  onStop,
  onPasswordEdited,
  onTimeout,
}: ExportVaultModalProps) {
  const { t } = useTranslation();
  const { showError } = useErrorToast();
  const vaultService = useVaultService();
  const formatGroup = useId();
  const sevenZipPasswordRef = useRef<HTMLInputElement>(null);
  const plainPasswordRef = useRef<HTMLInputElement>(null);
  const passwordRefs = { seven_zip: sevenZipPasswordRef, plain_zip: plainPasswordRef };
  const focusPasswordRef = useRef<VaultExportPasswordFormat | null>(null);
  const [chosenFormat, setChosenFormat] = useState<VaultExportFormat>(DEFAULT_VAULT_EXPORT_FORMAT);
  const [sevenZip, setSevenZip] = useState<VaultSettingsConfig["seven_zip"]>(DEFAULT_SEVEN_ZIP);
  const [passwords, setPasswords] = useState(NO_PASSWORDS);
  const [includes, setIncludes] = useState(DEFAULT_INCLUDES);
  const [sevenZipAvailable, setSevenZipAvailable] = useState(false);
  const exporting = running !== null;
  const exportingRef = useRef(exporting);
  exportingRef.current = exporting;
  const budget = useLoadingBudget(exporting, LOADING_BUDGET_MS.vaultExport, {
    startedAt: running?.startedAt,
  });
  const { cancelPick: cancelZipPick } = folders.store_zip;
  const { cancelPick: cancelSevenZipPick } = folders.seven_zip;
  const { cancelPick: cancelPlainPick } = folders.plain_zip;
  const vaultId = vault?.id ?? null;

  // Opening the window for a vault starts its choices over, unless it shows that
  // vault's export still running. An export that ends while the window is open
  // keeps them, so a refused password can be corrected in place.
  useEffect(() => {
    if (!open || vaultId === null) return;
    if (!exportingRef.current) {
      setChosenFormat(DEFAULT_VAULT_EXPORT_FORMAT);
      setSevenZip(DEFAULT_SEVEN_ZIP);
      setPasswords(NO_PASSWORDS);
      setIncludes(DEFAULT_INCLUDES);
      setSevenZipAvailable(false);
    }
    let cancelled = false;
    void vaultService
      .getSettings(vaultId)
      .then((settings) => {
        if (cancelled || exportingRef.current || !settings?.seven_zip) return;
        setSevenZip(settings.seven_zip);
      })
      .catch((error) => {
        if (cancelled) return;
        showError(error, "error.unexpected");
      });
    void vaultService
      .exportCapabilities()
      .then((caps) => {
        if (cancelled) return;
        setSevenZipAvailable(caps.sevenZip);
        if (!caps.sevenZip && !exportingRef.current) {
          setChosenFormat((current) =>
            current === "seven_zip" ? DEFAULT_VAULT_EXPORT_FORMAT : current,
          );
        }
      })
      .catch(() => {
        if (cancelled) return;
        setSevenZipAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, showError, vaultId, vaultService]);

  // The folders stay for the next export; a pick still open when the window closed is dropped.
  useEffect(() => {
    if (open) return;
    setPasswords(NO_PASSWORDS);
    cancelZipPick();
    cancelSevenZipPick();
    cancelPlainPick();
  }, [cancelPlainPick, cancelSevenZipPick, cancelZipPick, open]);

  useEffect(() => {
    if (!budget.timedOut || !exporting) return;
    onTimeout?.();
  }, [budget.timedOut, exporting, onTimeout]);

  useEffect(() => {
    if (focusPasswordRef.current !== chosenFormat) return;
    focusPasswordRef.current = null;
    (chosenFormat === "seven_zip" ? sevenZipPasswordRef : plainPasswordRef).current?.focus();
  }, [chosenFormat]);

  if (!open || !vault) return null;

  // While an export runs, the window shows the format being written.
  const format = running?.format ?? chosenFormat;
  const filenameKind = exportFilenameSanitizeKind(vault.displayName);
  const filename = vaultExportFilename(vault.displayName, format);
  const zipPending = vaultExportPending("store_zip", folders.store_zip.path, "");
  const passwordPending = (option: VaultExportPasswordFormat) =>
    vaultExportPending(option, folders[option].path, passwords[option]);
  const folder = folders[format];
  const formatReady =
    format === "store_zip"
      ? zipPending === null
      : (format !== "seven_zip" || sevenZipAvailable) &&
        passwordPending(format) === null &&
        passwordError === null;
  const ready = !exporting && !folder.picking && formatReady;

  const confirm = () => {
    if (!ready) return;
    onConfirm(
      {
        format,
        sevenZip,
        password: format === "store_zip" ? undefined : passwords[format],
        include: format === "store_zip" ? undefined : includes[format],
      },
      folder.path.trim(),
    );
  };

  /** Enter in a password: on to the folder while it is missing, then Export. */
  const passwordEntered = (option: VaultExportPasswordFormat) => {
    if (passwordPending(option) === "password" || passwordError !== null) return;
    if (folders[option].chooseIfMissing()) return;
    confirm();
  };

  const folderHint = (option: VaultExportFormat) =>
    t("vault.export.dialog.folder_hint", {
      filename: vaultExportFilename(vault.displayName, option),
      numbered: vaultExportFilename(vault.displayName, option, 2),
    });

  /** A refusal belongs to the option that got it. */
  const chooseFormat = (option: VaultExportFormat) => {
    if (option !== chosenFormat) onPasswordEdited?.();
    setChosenFormat(option);
  };

  const selectPasswordOption = (option: VaultExportPasswordFormat) => {
    if (exporting) return;
    // The card is a label for the radio, so its click focuses that control after
    // this handler. Defer until the password is enabled and that focus has landed.
    if (chosenFormat === option) {
      window.setTimeout(() => passwordRefs[option].current?.focus(), 0);
      return;
    }
    focusPasswordRef.current = option;
    chooseFormat(option);
  };

  const selectSevenZip = () => {
    if (sevenZipAvailable) selectPasswordOption("seven_zip");
  };

  /** The fields both options that decrypt the vault start with. */
  const passwordField = (option: VaultExportPasswordFormat, hint: string) => (
    <ExportPasswordField
      inputRef={passwordRefs[option]}
      hint={hint}
      value={passwords[option]}
      error={format === option ? passwordError : null}
      disabled={exporting}
      onEnter={() => passwordEntered(option)}
      onChange={(value) => {
        setPasswords((current) => ({ ...current, [option]: value }));
        onPasswordEdited?.();
      }}
    />
  );

  const includeSwitches = (option: VaultExportPasswordFormat) => (
    <ExportIncludeSwitches
      include={includes[option]}
      disabled={exporting}
      onChange={(include) => setIncludes((current) => ({ ...current, [option]: include }))}
    />
  );

  /** The option being written: how far it got, and how long it may still take. */
  const runningPanel = running ? (
    <div className="space-y-2">
      <JobProgressBar
        progress={running.progress}
        label={t("vault.export.dialog.title")}
        copy={VAULT_EXPORT_PROGRESS_COPY}
      />
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("vault.export.dialog.background_note")}
      </p>
      {budget.visible ? (
        <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
      ) : null}
    </div>
  ) : null;

  return (
    <Modal
      open={open}
      title={t("vault.export.dialog.title")}
      titleIcon="download"
      contextTitle={vault.displayName}
      onClose={onClose}
      panelClassName="max-w-lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {running ? (
            <Button variant="secondary" size="sm" disabled={running.stopping} onClick={onStop}>
              {running.stopping ? t("vault.export.dialog.stopping") : t("vault.export.dialog.stop")}
            </Button>
          ) : (
            <Button variant="primary" size="sm" disabled={!ready} onClick={confirm}>
              {t("vault.export.dialog.confirm")}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-on-surface-variant">
          {t("vault.export.dialog.format_help")}
        </p>
        {filenameKind === "adjusted" ? (
          <p className="text-sm leading-relaxed text-on-surface-variant">
            {t("vault.export.filename_sanitized", { filename })}
          </p>
        ) : null}
        {filenameKind === "fallback" ? (
          <p className="text-sm leading-relaxed text-on-error-container">
            {t("vault.export.invalid_filename")}
          </p>
        ) : null}
        <div role="radiogroup" className="grid gap-2">
          <PolicyRadioOption
            groupName={formatGroup}
            value="store_zip"
            checked={format === "store_zip"}
            title={t("vault.export.option.store_zip")}
            description={t("vault.export.option.store_zip_desc")}
            badge="recommended"
            disabled={exporting && format !== "store_zip"}
            attention={zipPending !== null}
            onSelect={() => {
              if (!exporting) chooseFormat("store_zip");
            }}
            footer={
              format === "store_zip" && runningPanel ? (
                runningPanel
              ) : (
                <div className="space-y-3">
                  <ExportFolderField
                    folder={folders.store_zip}
                    hint={folderHint("store_zip")}
                    disabled={exporting}
                  />
                  <p className="text-xs leading-relaxed text-on-surface-variant">
                    {t("vault.export.dialog.zip_no_compression")}
                  </p>
                </div>
              )
            }
          />
          <PolicyRadioOption
            groupName={formatGroup}
            value="seven_zip"
            checked={format === "seven_zip"}
            title={t("vault.export.option.seven_zip")}
            description={
              sevenZipAvailable
                ? t("vault.export.option.seven_zip_desc")
                : t("vault.export.dialog.seven_zip_unavailable")
            }
            disabled={exporting ? format !== "seven_zip" : !sevenZipAvailable}
            attention={passwordPending("seven_zip") !== null || passwordError !== null}
            onSelect={selectSevenZip}
            onCardPress={selectSevenZip}
            footer={
              format === "seven_zip" && runningPanel ? (
                runningPanel
              ) : (
                <div className="space-y-3">
                  {passwordField("seven_zip", t("vault.export.dialog.seven_zip_password_help"))}
                  <ExportFolderField
                    folder={folders.seven_zip}
                    hint={folderHint("seven_zip")}
                    disabled={exporting}
                  />
                  <VaultSettingsSevenZipSection
                    config={sevenZip}
                    disabled={exporting}
                    embedded
                    onChange={(patch) => setSevenZip((current) => ({ ...current, ...patch }))}
                  />
                  {includeSwitches("seven_zip")}
                </div>
              )
            }
          />
          <PolicyRadioOption
            groupName={formatGroup}
            value="plain_zip"
            checked={format === "plain_zip"}
            title={t("vault.export.option.plain_zip")}
            description={t("vault.export.option.plain_zip_desc")}
            badge="insecure"
            tone="insecure"
            disabled={exporting && format !== "plain_zip"}
            attention={passwordPending("plain_zip") !== null || passwordError !== null}
            onSelect={() => selectPasswordOption("plain_zip")}
            onCardPress={() => selectPasswordOption("plain_zip")}
            footer={
              format === "plain_zip" && runningPanel ? (
                runningPanel
              ) : (
                <div className="space-y-3">
                  {passwordField("plain_zip", t("vault.export.dialog.plain_zip_password_help"))}
                  <ExportFolderField
                    folder={folders.plain_zip}
                    hint={folderHint("plain_zip")}
                    disabled={exporting}
                  />
                  {includeSwitches("plain_zip")}
                </div>
              )
            }
          />
        </div>
      </div>
    </Modal>
  );
}
