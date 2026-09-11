import { useEffect, useState } from "react";
import { Text } from "react-native";
import {
  requireVaultErrorI18nKey,
  requiresPasswordForLifecycle,
  resolveVaultPasswordHint,
  storageModeIsPlaintext,
  VAULT_ERROR_CODES,
  type VaultLifecycleIntent,
  type VaultListItem,
} from "@upriv/shared";
import { useVaultLifecycleService, useVaultService } from "@/platform/services";
import { useTranslation, type I18nKey } from "@/i18n";
import { Button, Modal, ModalFooterActions } from "@/components/ui";
import { PasswordInput } from "@/components/settings/settingsFields";
import { useTheme } from "@/theme";

interface VaultLifecycleModalProps {
  vault: VaultListItem | null;
  intent: VaultLifecycleIntent | null;
  open: boolean;
  submitting?: boolean;
  onClose: () => void;
  onConfirm: (password: string | null) => void;
}

function modalTitleKey(intent: VaultLifecycleIntent): I18nKey {
  switch (intent) {
    case "unlock":
      return "unlock.title";
    case "close":
      return "close.dialog.title";
  }
}

function confirmLabelKey(intent: VaultLifecycleIntent): I18nKey {
  switch (intent) {
    case "unlock":
      return "unlock.submit";
    case "close":
      return "action.lock";
  }
}

export function VaultLifecycleModal({
  vault,
  intent,
  open,
  submitting = false,
  onClose,
  onConfirm,
}: VaultLifecycleModalProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const vaultService = useVaultService();
  const lifecycleService = useVaultLifecycleService();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Unlock always needs a password — do not wait on settings (desktop parity).
  const [requiresPassword, setRequiresPassword] = useState(intent === "unlock");
  const [settingsLoading, setSettingsLoading] = useState(false);

  useEffect(() => {
    if (!open || !vault || !intent) {
      setRequiresPassword(false);
      setSettingsLoading(false);
      return;
    }
    setRequiresPassword(intent === "unlock");
    let cancelled = false;
    setSettingsLoading(true);
    void vaultService
      .getSettings(vault.id)
      .then((settings) => {
        if (cancelled) return;
        if (!settings) {
          setRequiresPassword(true);
          return;
        }
        setRequiresPassword(requiresPasswordForLifecycle(vault, intent, settings.security.mode));
      })
      .catch(() => {
        if (!cancelled) setRequiresPassword(true);
      })
      .finally(() => {
        if (!cancelled) setSettingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, vault, intent, vaultService]);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setError(null);
  }, [open, vault?.id, intent]);

  if (!open || !vault || !intent) return null;

  const handleConfirm = () => {
    if (requiresPassword && !lifecycleService.validateLifecyclePassword(password)) {
      setError(t(requireVaultErrorI18nKey(VAULT_ERROR_CODES.WRONG_PASSWORD)));
      return;
    }
    onConfirm(requiresPassword ? password : null);
  };

  const canSubmit = !submitting && !settingsLoading && (!requiresPassword || password.length > 0);
  const passwordHint = resolveVaultPasswordHint(vault);

  return (
    <Modal
      open={open}
      title={t(modalTitleKey(intent))}
      titleIcon={intent === "unlock" ? "lock-open" : "lock"}
      contextTitle={vault.displayName}
      onClose={onClose}
      panelClassName="max-w-md"
      dismissible={!submitting}
      footer={
        <ModalFooterActions layout="dialog">
          <Button
            label={t("action.cancel")}
            variant="ghost"
            disabled={submitting}
            onPress={onClose}
          />
          <Button
            label={submitting ? t("close.dialog.submitting") : t(confirmLabelKey(intent))}
            variant="primary"
            disabled={!canSubmit}
            onPress={handleConfirm}
          />
        </ModalFooterActions>
      }
    >
      {intent === "close" ? (
        <>
          {storageModeIsPlaintext(vault.storageMode) ? (
            <Text style={typography.bodyMuted}>{t("close.dialog.close_hint_plain")}</Text>
          ) : null}
          {requiresPassword ? (
            <Text style={typography.bodyMuted}>{t("close.dialog.close_hint_prompt")}</Text>
          ) : null}
          {!storageModeIsPlaintext(vault.storageMode) && !requiresPassword ? (
            <Text style={typography.bodyMuted}>{t("close.dialog.close_hint")}</Text>
          ) : null}
        </>
      ) : null}

      {requiresPassword ? (
        <>
          {passwordHint ? (
            <Text style={[typography.caption, { color: colors.accent }]}>
              {t("unlock.password_hint_label")}: {passwordHint}
            </Text>
          ) : null}
          <PasswordInput
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              setError(null);
            }}
            autoFocus
            editable={!submitting}
            placeholder={t("unlock.password")}
            onSubmitEditing={() => {
              if (canSubmit) handleConfirm();
            }}
          />
        </>
      ) : null}

      {error ? (
        <Text style={[typography.body, { color: colors.onErrorContainer }]}>{error}</Text>
      ) : null}
    </Modal>
  );
}
