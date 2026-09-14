import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
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
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import { PolicyRadioOption, VaultSettingsSevenZipSection } from "@/components/settings";
import { Button, LoadingBudgetHint, Modal, ModalFooterActions } from "@/components/ui";
import { useLoadingBudget } from "@upriv/shared/react";
import { useVaultService } from "@/platform/services";

interface ExportVaultModalProps {
  vault: VaultListItem | null;
  open: boolean;
  submitting?: boolean;
  onClose: () => void;
  onConfirm: (request: VaultExportRequest) => void;
  onTimeout?: () => void;
  onSettingsLoadError?: (error: unknown) => void;
}

export function ExportVaultModal({
  vault,
  open,
  submitting = false,
  onClose,
  onConfirm,
  onTimeout,
  onSettingsLoadError,
}: ExportVaultModalProps) {
  const { t } = useTranslation();
  const vaultService = useVaultService();
  const { colors, typography } = useTheme();
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
        onSettingsLoadError?.(error);
      });
    return () => {
      cancelled = true;
    };
  }, [open, onSettingsLoadError, vault, vaultService]);

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
      dismissible={!submitting}
      panelClassName="max-w-lg"
      footer={
        <ModalFooterActions layout="dialog">
          <Button
            label={t("action.cancel")}
            variant="ghost"
            disabled={submitting}
            onPress={onClose}
          />
          <Button
            label={
              submitting ? t("vault.export.dialog.submitting") : t("vault.export.dialog.confirm")
            }
            variant="primary"
            disabled={submitting}
            busy={submitting}
            onPress={() => onConfirm({ format, sevenZip })}
          />
        </ModalFooterActions>
      }
    >
      <View style={styles.body}>
        <Text style={[typography.caption, { color: colors.onSurfaceVariant }]}>
          {t("vault.export.dialog.format_help")}
        </Text>
        {filenameKind === "adjusted" ? (
          <Text style={[typography.caption, { color: colors.onSurfaceVariant }]}>
            {t("vault.export.filename_sanitized", { filename })}
          </Text>
        ) : null}
        {filenameKind === "fallback" ? (
          <Text style={[typography.caption, { color: colors.onErrorContainer }]}>
            {t("vault.export.invalid_filename")}
          </Text>
        ) : null}
        <View accessibilityRole="radiogroup" style={styles.radios}>
          <PolicyRadioOption
            value="contents_zip"
            checked={format === "contents_zip"}
            title={t("vault.export.option.contents_zip")}
            description={t("vault.export.option.contents_zip_desc")}
            badge="recommended"
            onSelect={() => setFormat("contents_zip")}
            footer={
              <Text style={[typography.caption, { color: colors.onSurfaceVariant }]}>
                {t("vault.export.dialog.zip_no_compression")}
              </Text>
            }
          />
          <PolicyRadioOption
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
        </View>
        {submitting && budget.visible ? (
          <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  radios: { gap: spacing.sm },
});
