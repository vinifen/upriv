import { useEffect, useId, useRef, useState } from "react";
import { Button, LoadingBudgetHint, Modal, PasswordInput } from "@/components/ui";
import {
  PolicyRadioOption,
  SettingsField,
  settingsControlClass,
  VaultSettingsSevenZipSection,
} from "@/components/settings";
import { useExportPasswordCheck, useLoadingBudget } from "@upriv/shared/react";
import { useTranslation } from "@/i18n";
import { useVaultService } from "@/platform/services";
import { useErrorToast } from "@/hooks/useErrorToast";
import {
  DEFAULT_SEVEN_ZIP,
  DEFAULT_VAULT_EXPORT_FORMAT,
  LOADING_BUDGET_MS,
  exportFilenameSanitizeKind,
  vaultExportFilename,
  type VaultExportRequest,
  type VaultExportFormat,
  type VaultListItem,
  type VaultSettingsConfig,
} from "@upriv/shared";

interface ExportVaultModalProps {
  vault: VaultListItem | null;
  open: boolean;
  submitting?: boolean;
  onClose: () => void;
  onConfirm: (request: VaultExportRequest) => void;
  onTimeout?: () => void;
}

export function ExportVaultModal({
  vault,
  open,
  submitting = false,
  onClose,
  onConfirm,
  onTimeout,
}: ExportVaultModalProps) {
  const { t } = useTranslation();
  const { showError } = useErrorToast();
  const vaultService = useVaultService();
  const formatGroup = useId();
  const passwordId = useId();
  const passwordRef = useRef<HTMLInputElement>(null);
  const focusPasswordRef = useRef(false);
  const [format, setFormat] = useState<VaultExportFormat>(DEFAULT_VAULT_EXPORT_FORMAT);
  const [sevenZip, setSevenZip] = useState<VaultSettingsConfig["seven_zip"]>(DEFAULT_SEVEN_ZIP);
  const [password, setPassword] = useState("");
  const [sevenZipAvailable, setSevenZipAvailable] = useState(false);
  const passwordCheck = useExportPasswordCheck({
    open: open && vault != null,
    vaultId: vault?.id ?? null,
    password,
    probe: vaultService.probeExportPassword,
    onProbeError: (error) => showError(error, "error.unexpected"),
  });
  // Live export = flush `store/` + zip/.7z — same family as vaultRewrap. Mock finishes instantly.
  const budget = useLoadingBudget(submitting, LOADING_BUDGET_MS.vaultExport);

  useEffect(() => {
    if (!open || !vault) return;
    setFormat(DEFAULT_VAULT_EXPORT_FORMAT);
    setSevenZip(DEFAULT_SEVEN_ZIP);
    setPassword("");
    setSevenZipAvailable(false);
    let cancelled = false;
    void vaultService
      .getSettings(vault.id)
      .then((settings) => {
        if (cancelled || !settings?.seven_zip) return;
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
        if (!caps.sevenZip) setFormat(DEFAULT_VAULT_EXPORT_FORMAT);
      })
      .catch(() => {
        if (cancelled) return;
        setSevenZipAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, showError, vault, vaultService]);

  useEffect(() => {
    if (!budget.timedOut || !submitting) return;
    onTimeout?.();
  }, [budget.timedOut, onTimeout, submitting]);

  useEffect(() => {
    if (!focusPasswordRef.current || format !== "seven_zip") return;
    focusPasswordRef.current = false;
    passwordRef.current?.focus();
  }, [format]);

  if (!open || !vault) return null;

  const filenameKind = exportFilenameSanitizeKind(vault.displayName);
  const filename = vaultExportFilename(vault.displayName, format);
  const sevenZipReady = format !== "seven_zip" || (sevenZipAvailable && passwordCheck.passwordOk);

  const selectSevenZip = () => {
    if (submitting || !sevenZipAvailable) return;
    // The card is a label for the radio, so its click focuses that control after
    // this handler. Defer until the password is enabled and that focus has landed.
    if (format === "seven_zip") {
      window.setTimeout(() => passwordRef.current?.focus(), 0);
      return;
    }
    focusPasswordRef.current = true;
    setFormat("seven_zip");
  };

  return (
    <Modal
      open={open}
      title={t("vault.export.dialog.title")}
      titleIcon="download"
      contextTitle={vault.displayName}
      onClose={() => {
        if (!submitting) onClose();
      }}
      panelClassName="max-w-lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={submitting} onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={submitting || passwordCheck.checking || !sevenZipReady}
            onClick={() =>
              onConfirm({
                format,
                sevenZip,
                password: format === "seven_zip" ? password : undefined,
              })
            }
          >
            {submitting ? t("vault.export.dialog.submitting") : t("vault.export.dialog.confirm")}
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
            onSelect={() => setFormat("store_zip")}
            footer={
              <p className="text-xs leading-relaxed text-on-surface-variant">
                {t("vault.export.dialog.zip_no_compression")}
              </p>
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
            disabled={!sevenZipAvailable}
            attention={format === "seven_zip" && !passwordCheck.passwordOk}
            onSelect={selectSevenZip}
            onCardPress={selectSevenZip}
            footer={
              <>
                <SettingsField
                  label={t("vault.export.dialog.seven_zip_password")}
                  hint={t("vault.export.dialog.seven_zip_password_help")}
                  htmlFor={passwordId}
                >
                  <PasswordInput
                    ref={passwordRef}
                    id={passwordId}
                    value={password}
                    autoComplete="new-password"
                    disabled={submitting || passwordCheck.checking || format !== "seven_zip"}
                    className={settingsControlClass}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || passwordCheck.passwordOk) return;
                      event.preventDefault();
                      passwordCheck.check();
                    }}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      passwordCheck.notePasswordEdited();
                    }}
                  />
                </SettingsField>
                {passwordCheck.passwordOk ? (
                  <p className="mt-2 text-sm text-vault-open">
                    {t("vault.export.dialog.seven_zip_password_ok")}
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={submitting || format !== "seven_zip" || !passwordCheck.canCheck}
                      onClick={() => passwordCheck.check()}
                    >
                      {passwordCheck.checking
                        ? t("vault.export.dialog.seven_zip_password_checking")
                        : t("vault.export.dialog.seven_zip_password_check")}
                    </Button>
                    {passwordCheck.passwordWrong ? (
                      <p className="text-sm text-on-error-container">{t("error.wrong_password")}</p>
                    ) : null}
                    {passwordCheck.timedOut ? (
                      <p className="text-sm text-on-error-container">
                        {t("error.operation_timed_out")}
                      </p>
                    ) : null}
                    {passwordCheck.checking && passwordCheck.budget.visible ? (
                      <LoadingBudgetHint
                        budgetMs={passwordCheck.budget.budgetMs}
                        remainingMs={passwordCheck.budget.remainingMs}
                      />
                    ) : null}
                  </div>
                )}
                <div className="mt-3">
                  <VaultSettingsSevenZipSection
                    config={sevenZip}
                    disabled={format !== "seven_zip"}
                    embedded
                    onChange={(patch) => setSevenZip((current) => ({ ...current, ...patch }))}
                  />
                </div>
              </>
            }
          />
        </div>
        {submitting && budget.visible ? (
          <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
        ) : null}
      </div>
    </Modal>
  );
}
