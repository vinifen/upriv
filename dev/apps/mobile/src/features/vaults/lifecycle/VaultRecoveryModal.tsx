import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  vaultRecoveryCase,
  type PlainLeftover,
  type PlainRecoveryAction,
  type VaultListItem,
} from "@upriv/shared";
import { Button, Modal, ModalFooterActions } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";

interface VaultRecoveryModalProps {
  vault: VaultListItem | null;
  leftover: PlainLeftover | null | undefined;
  open: boolean;
  onClose: () => void;
  onAction: (action: PlainRecoveryAction) => void;
  /** Finish a password change that left files on an earlier key (the Password screen). */
  onFinishPasswordChange: () => void;
  /** Delete a vault whose import was cut off (the Delete vault window). */
  onDelete: () => void;
}

/**
 * Why a vault is in recovery, and its way out (`vaultRecoveryCase`, desktop
 * parity):
 * - A leftover plain-text folder: the warning is the only step. The button
 *   starts the wipe and this window closes; the row shows `recovering`.
 * - A password change that left files on an earlier key: Finish, on the
 *   Password screen, or an unlock that leaves it for later.
 * - An import a quit or a crash cut off: an unlock keeps what got in, or the
 *   Delete vault window removes it.
 * - A password change that did not finish: the unlock asks for the new password.
 * - A close that did not finish: unlock the store as it is.
 */
export function VaultRecoveryModal({
  vault,
  leftover,
  open,
  onClose,
  onAction,
  onFinishPasswordChange,
  onDelete,
}: VaultRecoveryModalProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();

  if (!open || !vault) return null;

  const recovery = vaultRecoveryCase(vault, leftover);
  const resume = () => onAction({ kind: "resume_store" });
  const text = (body: string) => <Text style={typography.bodyMuted}>{body}</Text>;

  let actions: ReactNode;
  let body: ReactNode = null;
  switch (recovery) {
    case "loading":
      actions = (
        <Button
          label={t("action.continue")}
          variant="primary"
          size="sm"
          disabled
          onPress={resume}
        />
      );
      break;
    case "remove_folder":
      actions = (
        <Button
          label={t("recovery.remove")}
          variant="danger"
          size="sm"
          onPress={() => onAction({ kind: "remove_folder" })}
        />
      );
      body = (
        <View style={styles.stack}>
          {text(
            t("recovery.hint_plain", { name: vault.displayName, since: leftover?.since ?? "" }),
          )}
          {text(t("recovery.remove_desc"))}
        </View>
      );
      break;
    case "finish_password_change":
      actions = (
        <>
          <Button label={t("action.unlock")} variant="secondary" size="sm" onPress={resume} />
          <Button
            label={t("recovery.finish_password_change")}
            variant="primary"
            size="sm"
            onPress={onFinishPasswordChange}
          />
        </>
      );
      body = (
        <View style={styles.stack}>
          {text(t("vault.change_password.unfinished"))}
          {text(t("recovery.finish_password_change_hint"))}
        </View>
      );
      break;
    case "import_unfinished":
      actions = (
        <>
          <Button
            label={t("modal.delete_vault.title")}
            variant="secondary"
            size="sm"
            onPress={onDelete}
          />
          <Button label={t("recovery.keep_import")} variant="primary" size="sm" onPress={resume} />
        </>
      );
      body = (
        <View style={styles.stack}>
          {text(t("recovery.import_unfinished", { name: vault.displayName }))}
          {text(t("recovery.import_unfinished_hint"))}
        </View>
      );
      break;
    case "password_change_pending":
    case "unfinished_close":
      actions = (
        <Button label={t("action.continue")} variant="primary" size="sm" onPress={resume} />
      );
      body = text(
        recovery === "password_change_pending"
          ? t("unlock.password_change_pending")
          : t("recovery.hint", { name: vault.displayName }),
      );
      break;
  }

  return (
    <Modal
      open={open}
      title={t("recovery.title")}
      titleIcon="refresh"
      contextTitle={vault.displayName}
      onClose={onClose}
      panelClassName="max-w-lg"
      footer={<ModalFooterActions layout="dialog">{actions}</ModalFooterActions>}
    >
      {body}
    </Modal>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
});
