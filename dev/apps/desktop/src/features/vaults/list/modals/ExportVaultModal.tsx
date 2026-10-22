import { useEffect, useId, useRef, useState } from "react";
import { Button, JobProgressBar, LoadingBudgetHint, Modal, PasswordInput } from "@/components/ui";
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
  LOADING_BUDGET_MS,
  VAULT_EXPORT_PROGRESS_COPY,
  exportFilenameSanitizeKind,
  vaultExportFilename,
  vaultExportPending,
  type VaultExportFormat,
  type VaultExportRequest,
  type VaultExportRun,
  type VaultListItem,
  type VaultSettingsConfig,
} from "@upriv/shared";
import type { VaultExportFolders } from "../hooks/useVaultExportFolders";

interface ExportVaultModalProps {
  vault: VaultListItem | null;
  open: boolean;
  /**
   * This vault's export in flight. The options are locked, and the one being
   * written shows how far it got in place of its fields.
   */
  running?: VaultExportRun | null;
  /** Why the last `.7z` export refused its password (wrong, or the unlock limit). */
  passwordError?: string | null;
  /** Each format's folder, kept by the vault list for the next export. */
  folders: VaultExportFolders;
  onClose: () => void;
  /** Export into `destDir`, the chosen format's folder. */
  onConfirm: (request: VaultExportRequest, destDir: string) => void;
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
  onPasswordEdited,
  onTimeout,
}: ExportVaultModalProps) {
  const { t } = useTranslation();
  const { showError } = useErrorToast();
  const vaultService = useVaultService();
  const formatGroup = useId();
  const passwordId = useId();
  const passwordRef = useRef<HTMLInputElement>(null);
  const focusPasswordRef = useRef(false);
  const [chosenFormat, setChosenFormat] = useState<VaultExportFormat>(DEFAULT_VAULT_EXPORT_FORMAT);
  const [sevenZip, setSevenZip] = useState<VaultSettingsConfig["seven_zip"]>(DEFAULT_SEVEN_ZIP);
  const [password, setPassword] = useState("");
  const [sevenZipAvailable, setSevenZipAvailable] = useState(false);
  const exporting = running !== null;
  const exportingRef = useRef(exporting);
  exportingRef.current = exporting;
  const budget = useLoadingBudget(exporting, LOADING_BUDGET_MS.vaultExport, {
    startedAt: running?.startedAt,
  });
  const { cancelPick: cancelZipPick } = folders.store_zip;
  const { cancelPick: cancelSevenZipPick } = folders.seven_zip;
  const vaultId = vault?.id ?? null;

  // Opening the window for a vault starts its choices over, unless it shows that
  // vault's export still running. An export that ends while the window is open
  // keeps them, so a refused password can be corrected in place.
  useEffect(() => {
    if (!open || vaultId === null) return;
    if (!exportingRef.current) {
      setChosenFormat(DEFAULT_VAULT_EXPORT_FORMAT);
      setSevenZip(DEFAULT_SEVEN_ZIP);
      setPassword("");
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
        if (!caps.sevenZip && !exportingRef.current) setChosenFormat(DEFAULT_VAULT_EXPORT_FORMAT);
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
    setPassword("");
    cancelZipPick();
    cancelSevenZipPick();
  }, [cancelSevenZipPick, cancelZipPick, open]);

  useEffect(() => {
    if (!budget.timedOut || !exporting) return;
    onTimeout?.();
  }, [budget.timedOut, exporting, onTimeout]);

  useEffect(() => {
    if (!focusPasswordRef.current || chosenFormat !== "seven_zip") return;
    focusPasswordRef.current = false;
    passwordRef.current?.focus();
  }, [chosenFormat]);

  if (!open || !vault) return null;

  // While an export runs, the window shows the format being written.
  const format = running?.format ?? chosenFormat;
  const filenameKind = exportFilenameSanitizeKind(vault.displayName);
  const filename = vaultExportFilename(vault.displayName, format);
  const zipPending = vaultExportPending("store_zip", folders.store_zip.path, "");
  const sevenZipPending = vaultExportPending("seven_zip", folders.seven_zip.path, password);
  const folder = folders[format];
  const formatReady =
    format === "store_zip"
      ? zipPending === null
      : sevenZipAvailable && sevenZipPending === null && passwordError === null;
  const ready = !exporting && !folder.picking && formatReady;

  const confirm = () => {
    if (!ready) return;
    onConfirm(
      {
        format,
        sevenZip,
        password: format === "seven_zip" ? password : undefined,
      },
      folder.path.trim(),
    );
  };

  const folderHint = (option: VaultExportFormat) =>
    t("vault.export.dialog.folder_hint", {
      filename: vaultExportFilename(vault.displayName, option),
      numbered: vaultExportFilename(vault.displayName, option, 2),
    });

  const selectSevenZip = () => {
    if (exporting || !sevenZipAvailable) return;
    // The card is a label for the radio, so its click focuses that control after
    // this handler. Defer until the password is enabled and that focus has landed.
    if (chosenFormat === "seven_zip") {
      window.setTimeout(() => passwordRef.current?.focus(), 0);
      return;
    }
    focusPasswordRef.current = true;
    setChosenFormat("seven_zip");
  };

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
          <Button variant="ghost" size="sm" onClick={onClose}>
            {exporting ? t("action.close") : t("action.cancel")}
          </Button>
          <Button variant="primary" size="sm" disabled={!ready} onClick={confirm}>
            {exporting ? t("vault.export.dialog.submitting") : t("vault.export.dialog.confirm")}
          </Button>
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
              if (!exporting) setChosenFormat("store_zip");
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
            attention={sevenZipPending !== null || passwordError !== null}
            onSelect={selectSevenZip}
            onCardPress={selectSevenZip}
            footer={
              format === "seven_zip" && runningPanel ? (
                runningPanel
              ) : (
                <div className="space-y-3">
                  <SettingsField
                    label={t("vault.export.dialog.seven_zip_password")}
                    hint={t("vault.export.dialog.seven_zip_password_help")}
                    htmlFor={passwordId}
                  >
                    <PasswordInput
                      ref={passwordRef}
                      id={passwordId}
                      value={password}
                      autoComplete="current-password"
                      disabled={exporting}
                      aria-invalid={passwordError ? true : undefined}
                      aria-errormessage={passwordError ? `${passwordId}-error` : undefined}
                      inputClassName={[settingsControlClass, settingsInvalidControlClass].join(" ")}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        confirm();
                      }}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        onPasswordEdited?.();
                      }}
                    />
                    {passwordError ? (
                      <p
                        id={`${passwordId}-error`}
                        role="alert"
                        className="text-xs text-on-error-container"
                      >
                        {passwordError}
                      </p>
                    ) : null}
                  </SettingsField>
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
                </div>
              )
            }
          />
        </div>
      </div>
    </Modal>
  );
}
