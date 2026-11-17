import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  VAULT_DELETE_HOLD_I18N_KEY,
  VAULT_SETTINGS_MENU_ICON,
  isVaultDeleteUnfinished,
  jobStepCopy,
  vaultDeleteHold,
  type VaultListItem,
  type VaultPipelineListStatus,
} from "@upriv/shared";
import type { VaultDeleteJob } from "@upriv/shared/react";
import { FieldLabel, SwitchRow, ThemedInput } from "@/components/settings";
import { Button, JobProgressBar, Modal, ModalFooterActions } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useVaultService } from "@/platform/services";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";

interface VaultDeleteModalProps {
  /** The vault whose window is open; `null` keeps the window closed. */
  vault: VaultListItem | null;
  pipelineListStatus: VaultPipelineListStatus;
  /** The delete in flight, of whichever vault; the list owns it. */
  job: VaultDeleteJob | null;
  onClose: () => void;
  /** Start the delete, or Continue one that did not finish. False when it cannot start. */
  onDelete: (vaultId: string, outsideBackups: boolean) => boolean;
}

/**
 * The Delete vault window, opened from the row's Settings menu. Each opening
 * starts with nothing typed and the outside backups kept.
 */
export function VaultDeleteModal({ vault, ...props }: VaultDeleteModalProps) {
  if (!vault) return null;
  return <VaultDeleteWindow key={vault.id} vault={vault} {...props} />;
}

/**
 * What a delete removes, the vault ID to type, and the outside-backups
 * switch. While the delete runs, its step, bar, and elapsed time in their
 * place: it goes on when the window closes, and Delete now in More options
 * ends it early. One that did not finish offers Continue.
 */
function VaultDeleteWindow({
  vault,
  pipelineListStatus,
  job,
  onClose,
  onDelete,
}: Omit<VaultDeleteModalProps, "vault"> & { vault: VaultListItem }) {
  const { t } = useTranslation();
  const { typography, colors } = useTheme();
  const vaultService = useVaultService();
  const [confirm, setConfirm] = useState("");
  const [removeOutsideBackups, setRemoveOutsideBackups] = useState(false);

  const running = job !== null && job.vaultId === vault.id ? job : null;
  const unfinished = isVaultDeleteUnfinished(vault, pipelineListStatus);
  const hold = unfinished ? null : vaultDeleteHold(vault, pipelineListStatus);
  const canSubmit =
    vaultService.canDeleteVault && (unfinished || (hold === null && confirm.trim() === vault.id));

  const submit = () => {
    if (!canSubmit) return;
    if (onDelete(vault.id, removeOutsideBackups)) setConfirm("");
  };

  const muted = [typography.body, { color: colors.onSurfaceVariant }];

  return (
    <Modal
      open
      title={t("modal.delete_vault.title")}
      titleIcon={VAULT_SETTINGS_MENU_ICON.delete}
      contextTitle={vault.displayName}
      panelClassName="max-w-lg"
      onClose={onClose}
      footer={
        running ? undefined : (
          <ModalFooterActions layout="dialog">
            <Button label={t("action.cancel")} variant="ghost" size="md" onPress={onClose} />
            <Button
              label={t(unfinished ? "action.continue_delete" : "modal.delete_vault.submit")}
              variant="danger"
              size="md"
              disabled={!canSubmit}
              onPress={submit}
            />
          </ModalFooterActions>
        )
      }
    >
      {running ? (
        <View style={styles.body}>
          <JobProgressBar
            progress={running.progress}
            startedAt={running.startedAt}
            label={t("modal.delete_vault.title")}
            copy={jobStepCopy(running.progress, "job.step.overwriting")}
          />
          <Text style={[typography.caption, { color: colors.onSurfaceVariant }]}>
            {t("modal.delete_vault.running")}
          </Text>
        </View>
      ) : unfinished ? (
        <Text style={muted}>{t("modal.delete_vault.unfinished")}</Text>
      ) : (
        <View style={styles.body}>
          <Text style={muted}>{t("modal.delete_vault.help")}</Text>
          {hold ? <Text style={muted}>{t(VAULT_DELETE_HOLD_I18N_KEY[hold])}</Text> : null}
          <FieldLabel disabled={hold !== null}>{t("modal.delete_vault.confirm")}</FieldLabel>
          <Text style={typography.mono}>{vault.id}</Text>
          <ThemedInput
            value={confirm}
            onChangeText={setConfirm}
            onSubmitEditing={submit}
            accessibilityLabel={t("modal.delete_vault.confirm")}
            disabled={hold !== null}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            spellCheck={false}
            mono
          />
          {vault.outsideBackups === true ? (
            <SwitchRow
              label={t("modal.delete_vault.outside_backups")}
              hint={t("modal.delete_vault.outside_backups_help")}
              value={removeOutsideBackups}
              onValueChange={setRemoveOutsideBackups}
              disabled={hold !== null}
            />
          ) : null}
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
});
