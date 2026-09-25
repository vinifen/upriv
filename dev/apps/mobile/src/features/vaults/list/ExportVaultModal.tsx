import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
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
import {
  FieldHint,
  FieldLabel,
  PasswordInput,
  PolicyRadioOption,
  VaultSettingsSevenZipSection,
} from "@/components/settings";
import { Button, LoadingBudgetHint, Modal, ModalFooterActions } from "@/components/ui";
import { useExportPasswordCheck, useLoadingBudget } from "@upriv/shared/react";
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
  const [password, setPassword] = useState("");
  const passwordCheck = useExportPasswordCheck({
    open: open && vault != null,
    vaultId: vault?.id ?? null,
    password,
    probe: vaultService.probeExportPassword,
    onProbeError: (error) => onSettingsLoadError?.(error),
  });
  const passwordRef = useRef<TextInput>(null);
  const focusPasswordRef = useRef(false);
  const [sevenZipAvailable, setSevenZipAvailable] = useState(false);
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
        onSettingsLoadError?.(error);
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
  }, [open, onSettingsLoadError, vault, vaultService]);

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
    if (format === "seven_zip") {
      passwordRef.current?.focus();
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
            disabled={submitting || passwordCheck.checking || !sevenZipReady}
            busy={submitting}
            onPress={() =>
              onConfirm({
                format,
                sevenZip,
                password: format === "seven_zip" ? password : undefined,
              })
            }
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
            value="store_zip"
            checked={format === "store_zip"}
            title={t("vault.export.option.store_zip")}
            description={t("vault.export.option.store_zip_desc")}
            badge="recommended"
            onSelect={() => setFormat("store_zip")}
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
            description={
              sevenZipAvailable
                ? t("vault.export.option.seven_zip_desc")
                : t("vault.export.dialog.seven_zip_unavailable")
            }
            disabled={!sevenZipAvailable}
            attention={format === "seven_zip" && !passwordCheck.passwordOk}
            onSelect={selectSevenZip}
            footer={
              <View style={styles.sevenZipFooter}>
                <View style={styles.passwordBlock}>
                  <FieldLabel>{t("vault.export.dialog.seven_zip_password")}</FieldLabel>
                  <FieldHint>{t("vault.export.dialog.seven_zip_password_help")}</FieldHint>
                  <PasswordInput
                    ref={passwordRef}
                    value={password}
                    editable={!submitting && !passwordCheck.checking && format === "seven_zip"}
                    autoComplete="password-new"
                    onSubmitEditing={() => {
                      if (!passwordCheck.passwordOk) passwordCheck.check();
                    }}
                    onChangeText={(value) => {
                      setPassword(value);
                      passwordCheck.notePasswordEdited();
                    }}
                  />
                  {passwordCheck.passwordOk ? (
                    <Text style={[typography.caption, { color: colors.vaultStatusOpen }]}>
                      {t("vault.export.dialog.seven_zip_password_ok")}
                    </Text>
                  ) : (
                    <View style={styles.passwordBlock}>
                      <Button
                        label={
                          passwordCheck.checking
                            ? t("vault.export.dialog.seven_zip_password_checking")
                            : t("vault.export.dialog.seven_zip_password_check")
                        }
                        variant="secondary"
                        disabled={submitting || format !== "seven_zip" || !passwordCheck.canCheck}
                        busy={passwordCheck.checking}
                        onPress={() => passwordCheck.check()}
                      />
                      {passwordCheck.passwordWrong ? (
                        <Text style={[typography.caption, { color: colors.onErrorContainer }]}>
                          {t("error.wrong_password")}
                        </Text>
                      ) : null}
                      {passwordCheck.timedOut ? (
                        <Text style={[typography.caption, { color: colors.onErrorContainer }]}>
                          {t("error.operation_timed_out")}
                        </Text>
                      ) : null}
                      {passwordCheck.checking && passwordCheck.budget.visible ? (
                        <LoadingBudgetHint
                          budgetMs={passwordCheck.budget.budgetMs}
                          remainingMs={passwordCheck.budget.remainingMs}
                        />
                      ) : null}
                    </View>
                  )}
                </View>
                <VaultSettingsSevenZipSection
                  config={sevenZip}
                  disabled={format !== "seven_zip"}
                  embedded
                  onChange={(patch) => setSevenZip((current) => ({ ...current, ...patch }))}
                />
              </View>
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
  sevenZipFooter: { gap: spacing.sm },
  passwordBlock: { gap: spacing.xs },
});
