import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import {
  lifecycleBusyLabelKey,
  requireVaultErrorI18nKey,
  resolveVaultPasswordHint,
  vaultRowWorkClock,
  VAULT_ERROR_CODES,
  type VaultListItem,
  type VaultRowWork,
} from "@upriv/shared";
import { useVaultLifecycleService } from "@/platform/services";
import { useTranslation, type I18nKey } from "@/i18n";
import { Button, ElapsedTime, JobStopButton, Modal, ModalFooterActions } from "@/components/ui";
import { FieldLabel, PasswordInput } from "@/components/settings/settingsFields";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";

interface VaultLifecycleModalProps {
  vault: VaultListItem | null;
  open: boolean;
  submitting?: boolean;
  pipelineStep?: number;
  /** The open in flight for this vault: its clock and its Stop. */
  work?: VaultRowWork | null;
  verifyErrorKey?: I18nKey | null;
  /** Prefill after a failed attempt — the field, not the session RAM map. */
  initialPassword?: string;
  onClose: () => void;
  onConfirm: (password: string) => void;
  onStop: () => void;
}

/** Unlock password dialog. Lock starts the close without a dialog. */
export function VaultLifecycleModal({
  vault,
  open,
  submitting = false,
  pipelineStep = 0,
  work = null,
  verifyErrorKey = null,
  initialPassword,
  onClose,
  onConfirm,
  onStop,
}: VaultLifecycleModalProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const lifecycleService = useVaultLifecycleService();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!open) {
      setPassword("");
      return;
    }
    setPassword(initialPassword ?? "");
    setError(null);
  }, [open, vault?.id, initialPassword]);

  useEffect(() => {
    if (!verifyErrorKey) return;
    setError(t(verifyErrorKey));
  }, [t, verifyErrorKey]);

  useEffect(() => {
    if (!open) return;
    // Android shows the dialog with FLAG_NOT_FOCUSABLE and clears that flag
    // only after Dialog.show() returns. autoFocus lands in that window, so
    // the field looks focused and the keyboard never opens.
    const id = setTimeout(() => passwordRef.current?.focus(), 100);
    return () => clearTimeout(id);
  }, [open, vault?.id]);

  if (!open || !vault) return null;

  const handleConfirm = () => {
    if (!lifecycleService.validateLifecyclePassword(password)) {
      setError(t(requireVaultErrorI18nKey(VAULT_ERROR_CODES.WRONG_PASSWORD)));
      return;
    }
    setError(null);
    onConfirm(password);
  };

  const canSubmit = !submitting && lifecycleService.validateLifecyclePassword(password);
  const passwordHint = resolveVaultPasswordHint(vault);

  return (
    <Modal
      open={open}
      title={t("unlock.title")}
      titleIcon="lock-open"
      contextTitle={vault.displayName}
      onClose={onClose}
      panelClassName="max-w-md"
      dismissible
      footer={
        <ModalFooterActions layout="dialog">
          {submitting && work?.stop ? (
            <JobStopButton
              stoppingSince={work.stoppingSince}
              stoppable={work.stop !== "final"}
              onStop={onStop}
            />
          ) : (
            <Button
              label={
                submitting
                  ? work?.startedAt != null
                    ? t(lifecycleBusyLabelKey("unlock", pipelineStep))
                    : t("vault.status.queued")
                  : t("unlock.submit")
              }
              variant="primary"
              disabled={!canSubmit}
              onPress={handleConfirm}
            />
          )}
        </ModalFooterActions>
      }
    >
      <View style={styles.passwordBlock}>
        <View style={styles.passwordField}>
          <FieldLabel>{t("unlock.password")}</FieldLabel>
          <PasswordInput
            ref={passwordRef}
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              setError(null);
            }}
            showSoftInputOnFocus
            onSubmitEditing={() => {
              if (canSubmit) handleConfirm();
            }}
          />
        </View>
        {passwordHint ? (
          <Text style={[typography.caption, { color: colors.onSurfaceVariant, lineHeight: 16 }]}>
            {t("unlock.password_hint_label")} · {passwordHint}
          </Text>
        ) : null}
      </View>

      {error ? (
        <Text style={[typography.body, { color: colors.onErrorContainer }]}>{error}</Text>
      ) : null}

      {submitting ? (
        <Text style={[typography.body, { color: colors.onSurfaceVariant }]}>
          {work?.startedAt != null
            ? t(lifecycleBusyLabelKey("unlock", pipelineStep))
            : t("vault.status.queued")}
        </Text>
      ) : null}
      {submitting && work?.stop !== "stopping" ? (
        <ElapsedTime startedAt={vaultRowWorkClock(work)} />
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  passwordBlock: { gap: spacing.sm },
  passwordField: { gap: spacing.sm },
});
