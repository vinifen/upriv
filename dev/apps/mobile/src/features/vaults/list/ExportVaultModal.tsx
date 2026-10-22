import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
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
import { ExportFolderField } from "@/components/ExportFolderField";
import {
  Button,
  JobProgressBar,
  LoadingBudgetHint,
  Modal,
  ModalFooterActions,
} from "@/components/ui";
import { useLoadingBudget } from "@upriv/shared/react";
import { useVaultService } from "@/platform/services";
import type { VaultExportFolders } from "./hooks/useVaultExportFolders";

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
  onSettingsLoadError?: (error: unknown) => void;
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
  onSettingsLoadError,
}: ExportVaultModalProps) {
  const { t } = useTranslation();
  const vaultService = useVaultService();
  const { colors, typography } = useTheme();
  const [chosenFormat, setChosenFormat] = useState<VaultExportFormat>(DEFAULT_VAULT_EXPORT_FORMAT);
  const [sevenZip, setSevenZip] = useState<VaultSettingsConfig["seven_zip"]>(DEFAULT_SEVEN_ZIP);
  const [password, setPassword] = useState("");
  const passwordRef = useRef<TextInput>(null);
  const focusPasswordRef = useRef(false);
  const [sevenZipAvailable, setSevenZipAvailable] = useState(false);
  const exporting = running !== null;
  const exportingRef = useRef(exporting);
  exportingRef.current = exporting;
  // Read through a ref: the list passes a new function on every render, and
  // the window must not start over when the list re-renders (a folder pick).
  const onSettingsLoadErrorRef = useRef(onSettingsLoadError);
  onSettingsLoadErrorRef.current = onSettingsLoadError;
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
        onSettingsLoadErrorRef.current?.(error);
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
  }, [open, vaultId, vaultService]);

  // The folders stay for the next export; a pick still open when the window closed is let go.
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
    if (chosenFormat === "seven_zip") {
      passwordRef.current?.focus();
      return;
    }
    focusPasswordRef.current = true;
    setChosenFormat("seven_zip");
  };

  /** The option being written: how far it got, and how long it may still take. */
  const runningPanel = running ? (
    <View style={styles.footer}>
      <JobProgressBar
        progress={running.progress}
        label={t("vault.export.dialog.title")}
        copy={VAULT_EXPORT_PROGRESS_COPY}
      />
      <Text style={typography.caption}>{t("vault.export.dialog.background_note")}</Text>
      {budget.visible ? (
        <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
      ) : null}
    </View>
  ) : null;

  return (
    <Modal
      open={open}
      title={t("vault.export.dialog.title")}
      titleIcon="download"
      contextTitle={vault.displayName}
      onClose={() => {
        onClose();
      }}
      dismissible
      panelClassName="max-w-lg"
      footer={
        <ModalFooterActions layout="dialog">
          <Button
            label={exporting ? t("action.close") : t("action.cancel")}
            variant="ghost"
            onPress={onClose}
          />
          <Button
            label={
              exporting ? t("vault.export.dialog.submitting") : t("vault.export.dialog.confirm")
            }
            variant="primary"
            disabled={!ready}
            busy={exporting}
            onPress={confirm}
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
            disabled={exporting && format !== "store_zip"}
            attention={zipPending !== null}
            onSelect={() => {
              if (!exporting) setChosenFormat("store_zip");
            }}
            footer={
              format === "store_zip" && runningPanel ? (
                runningPanel
              ) : (
                <View style={styles.footer}>
                  <ExportFolderField
                    folder={folders.store_zip}
                    hint={folderHint("store_zip")}
                    disabled={exporting}
                  />
                  <Text style={[typography.caption, { color: colors.onSurfaceVariant }]}>
                    {t("vault.export.dialog.zip_no_compression")}
                  </Text>
                </View>
              )
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
            disabled={exporting ? format !== "seven_zip" : !sevenZipAvailable}
            attention={sevenZipPending !== null || passwordError !== null}
            onSelect={selectSevenZip}
            footer={
              format === "seven_zip" && runningPanel ? (
                runningPanel
              ) : (
                <View style={styles.footer}>
                  <View style={styles.passwordBlock}>
                    <FieldLabel>{t("vault.export.dialog.seven_zip_password")}</FieldLabel>
                    <FieldHint>{t("vault.export.dialog.seven_zip_password_help")}</FieldHint>
                    <PasswordInput
                      ref={passwordRef}
                      value={password}
                      editable={!exporting}
                      invalid={passwordError !== null}
                      autoComplete="password"
                      autoCapitalize="none"
                      autoCorrect={false}
                      onSubmitEditing={confirm}
                      onChangeText={(value) => {
                        setPassword(value);
                        onPasswordEdited?.();
                      }}
                    />
                    {passwordError ? (
                      <Text
                        accessibilityRole="alert"
                        style={[typography.caption, { color: colors.onErrorContainer }]}
                      >
                        {passwordError}
                      </Text>
                    ) : null}
                  </View>
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
                </View>
              )
            }
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  radios: { gap: spacing.sm },
  footer: { gap: spacing.sm },
  passwordBlock: { gap: spacing.xs },
});
