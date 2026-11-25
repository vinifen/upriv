import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import {
  jobStepCopy,
  lifecycleBusyLabelKey,
  offersVaultRebuild,
  requireVaultErrorI18nKey,
  resolveVaultPasswordHint,
  storageModeIsPlaintext,
  unlockFolderLine,
  VAULT_ERROR_CODES,
  type UnlockedDestination,
  type VaultListItem,
  type VaultRowWork,
} from "@upriv/shared";
import { useUnlockedDestination } from "@upriv/shared/react";
import { rpcVaultUnlockedDestination } from "@/lib/rpc";
import { useVaultLifecycleService } from "@/platform/services";
import { useTranslation, type I18nKey } from "@/i18n";
import { Button, JobProgressBar, JobStopButton, Modal, ModalFooterActions } from "@/components/ui";
import { UnlockedFolderLineView } from "@/components/settings";
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
  /**
   * Where the files will appear, when the step before the window looked it
   * up. Without it the window looks it up itself and fills the line in.
   */
  destination?: UnlockedDestination | null;
  onClose: () => void;
  onConfirm: (password: string) => void;
  onStop: () => void;
  /**
   * The unlock found the vault's index or header lost: rebuild it with the
   * password typed. The vault list runs the rebuild, so the window closes.
   */
  onRebuild: (password: string) => void;
}

/**
 * Unlock password dialog. Lock starts the close without a dialog. When the
 * vault's index or header is lost, the dialog offers the rebuild from the
 * vault's own data. A password change that did not finish asks for the new
 * password. Before the password a plain-text vault names the folder its
 * files will be written to; a phone mounts no encrypted vault's folder, so
 * an encrypted vault has no line.
 */
export function VaultLifecycleModal({
  vault,
  open,
  submitting = false,
  pipelineStep = 0,
  work = null,
  verifyErrorKey = null,
  initialPassword,
  destination = null,
  onClose,
  onConfirm,
  onStop,
  onRebuild,
}: VaultLifecycleModalProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const lifecycleService = useVaultLifecycleService();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const mode = vault?.storageMode ?? "encrypted_dir";
  const lookedUp = useUnlockedDestination(
    rpcVaultUnlockedDestination,
    vault?.id ?? null,
    mode,
    open && destination === null && storageModeIsPlaintext(mode),
  );
  const folderAnswer = destination ?? lookedUp.answer;

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
  // Shown for the password that found the index or header lost; editing it hides the offer.
  const rebuildOffered = !submitting && error !== null && offersVaultRebuild(verifyErrorKey);
  const headerLost =
    verifyErrorKey === requireVaultErrorI18nKey(VAULT_ERROR_CODES.HEADER_UNREADABLE);
  const busyKey = lifecycleBusyLabelKey("unlock", pipelineStep);

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
          ) : rebuildOffered ? (
            <Button
              label={t("unlock.rebuild")}
              variant="primary"
              onPress={() => onRebuild(password)}
            />
          ) : (
            <Button
              label={t("unlock.submit")}
              variant="primary"
              disabled={!canSubmit}
              onPress={handleConfirm}
            />
          )}
        </ModalFooterActions>
      }
    >
      {vault.passwordChange === "pending" && error === null ? (
        <Text style={[typography.body, { color: colors.onSurface }]}>
          {t("unlock.password_change_pending")}
        </Text>
      ) : null}
      <UnlockedFolderLineView
        checking={destination === null && lookedUp.checking}
        line={folderAnswer ? unlockFolderLine(folderAnswer, mode) : null}
        checkingKey="unlock.folder.checking"
      />
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
      {rebuildOffered ? (
        <Text style={[typography.body, { color: colors.onSurfaceVariant }]}>
          {t(headerLost ? "unlock.rebuild_header_help" : "unlock.rebuild_help")}
        </Text>
      ) : null}

      {/* Stop counts its own wait; the bar shows the step until then. */}
      {submitting && work?.stop !== "stopping" ? (
        <View style={styles.progress}>
          <JobProgressBar
            progress={null}
            startedAt={work?.startedAt ?? null}
            label={t("unlock.title")}
            copy={jobStepCopy(null, busyKey)}
          />
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  passwordBlock: { gap: spacing.sm },
  passwordField: { gap: spacing.sm },
  progress: { gap: spacing.xs },
});
