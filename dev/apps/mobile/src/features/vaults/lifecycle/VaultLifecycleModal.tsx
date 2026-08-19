import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import {
  requireVaultErrorI18nKey,
  requiresPasswordForLifecycle,
  VAULT_ERROR_CODES,
  type VaultLifecycleIntent,
  type VaultListItem,
} from "@upriv/shared";
import { useVaultLifecycleService, useVaultService } from "@/platform/services";
import { useTranslation, type I18nKey } from "@/i18n";
import { Button, Modal } from "@/components/ui";
import { useTheme } from "@/theme";
import { radii, spacing } from "@/theme/tokens";

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
    case "seal":
      return "close.dialog.seal_title";
    case "close":
      return "close.dialog.title";
  }
}

function confirmLabelKey(intent: VaultLifecycleIntent): I18nKey {
  switch (intent) {
    case "unlock":
      return "unlock.submit";
    case "seal":
      return "action.seal";
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
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !vault || !intent) {
      setRequiresPassword(false);
      setHint(null);
      return;
    }
    let cancelled = false;
    void vaultService.getSettings(vault.id).then((settings) => {
      if (cancelled || !settings) return;
      setRequiresPassword(
        requiresPasswordForLifecycle(
          vault,
          intent,
          settings.security.mode,
          lifecycleService.hasPasswordInSession(vault.id),
        ),
      );
      const fromSettings = settings.vault.password_hint?.trim();
      const fromRow = vault.passwordHint?.trim();
      setHint(fromSettings || fromRow || null);
    });
    return () => {
      cancelled = true;
    };
  }, [lifecycleService, open, vault, intent, vaultService]);

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

  return (
    <Modal
      open={open}
      title={t(modalTitleKey(intent), { name: vault.displayName })}
      onClose={onClose}
      panelClassName="max-w-md"
      dismissible={!submitting}
    >
      {intent === "close" ? (
        <Text style={typography.bodyMuted}>{t("close.dialog.close_hint")}</Text>
      ) : null}
      {intent === "seal" ? (
        <>
          <Text style={typography.bodyMuted}>{t("close.dialog.seal_hint")}</Text>
          <Text style={typography.bodyMuted}>{t("close.dialog.seal_confirm")}</Text>
        </>
      ) : null}

      {requiresPassword ? (
        <>
          {hint ? (
            <Text style={[typography.caption, { color: colors.accent }]}>
              {t("unlock.password_hint_label")}: {hint}
            </Text>
          ) : null}
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoFocus
            editable={!submitting}
            placeholder={t("unlock.password")}
            placeholderTextColor={colors.onSurfaceVariant}
            style={[
              styles.input,
              {
                ...typography.body,
                backgroundColor: colors.surfaceContainerHigh,
                borderColor: colors.outlineVariant,
              },
            ]}
            onSubmitEditing={handleConfirm}
          />
        </>
      ) : null}

      {error ? (
        <Text style={[typography.body, { color: colors.onErrorContainer }]}>{error}</Text>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={t("action.cancel")}
          variant="ghost"
          disabled={submitting}
          onPress={onClose}
        />
        <Button
          label={submitting ? t("close.dialog.submitting") : t(confirmLabelKey(intent))}
          variant="accent"
          disabled={submitting || (requiresPassword && password.length === 0)}
          onPress={handleConfirm}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  input: {
    borderRadius: radii.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 44,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "flex-end",
    marginTop: spacing.sm,
  },
});
