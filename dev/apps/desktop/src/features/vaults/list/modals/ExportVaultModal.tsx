import { useEffect, useId, useState } from "react";
import { Button, LoadingBudgetHint, Modal } from "@/components/ui";
import { PolicyRadioOption, VaultSettingsSevenZipSection } from "@/components/settings";
import { useLoadingBudget } from "@upriv/shared/react";
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
  const [format, setFormat] = useState<VaultExportFormat>(DEFAULT_VAULT_EXPORT_FORMAT);
  const [sevenZip, setSevenZip] = useState<VaultSettingsConfig["seven_zip"]>(DEFAULT_SEVEN_ZIP);
  // Live export = flush `contents/` + zip/.7z — same family as vaultRewrap. Mock finishes instantly.
  const budget = useLoadingBudget(submitting, LOADING_BUDGET_MS.vaultExport);

  useEffect(() => {
    if (!open || !vault) return;
    setFormat(DEFAULT_VAULT_EXPORT_FORMAT);
    setSevenZip(DEFAULT_SEVEN_ZIP);
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
    return () => {
      cancelled = true;
    };
  }, [open, showError, vault, vaultService]);

  useEffect(() => {
    if (!budget.timedOut || !submitting) return;
    onTimeout?.();
  }, [budget.timedOut, onTimeout, submitting]);

  if (!open || !vault) return null;

  const filenameKind = exportFilenameSanitizeKind(vault.displayName);
  const filename = vaultExportFilename(vault.displayName, format);

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
            disabled={submitting}
            onClick={() => onConfirm({ format, sevenZip })}
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
            value="contents_zip"
            checked={format === "contents_zip"}
            title={t("vault.export.option.contents_zip")}
            description={t("vault.export.option.contents_zip_desc")}
            badge="recommended"
            onSelect={() => setFormat("contents_zip")}
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
            description={t("vault.export.option.seven_zip_desc")}
            onSelect={() => setFormat("seven_zip")}
            footer={
              <VaultSettingsSevenZipSection
                config={sevenZip}
                disabled={format !== "seven_zip"}
                embedded
                onChange={(patch) => setSevenZip((current) => ({ ...current, ...patch }))}
              />
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
