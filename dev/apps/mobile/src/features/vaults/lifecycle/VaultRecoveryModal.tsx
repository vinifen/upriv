import { StyleSheet, Text, View } from "react-native";
import {
  plainRecoveryOffers,
  storageModeIsPlaintext,
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
}

/**
 * Dirty-close recovery. The button on a leftover plaintext folder starts its
 * wipe and this window closes; the row shows `recovering` until it ends.
 */
export function VaultRecoveryModal({
  vault,
  leftover,
  open,
  onClose,
  onAction,
}: VaultRecoveryModalProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  const isPlain = vault ? storageModeIsPlaintext(vault.storageMode) : false;
  const pending = isPlain && leftover === undefined;
  const offers = plainRecoveryOffers(pending ? null : (leftover ?? null));

  if (!open || !vault) return null;

  const runPrimary = () => {
    if (pending) return;
    onAction(offers.remove ? { kind: "remove_folder" } : { kind: "resume_store" });
  };

  return (
    <Modal
      open={open}
      title={t("recovery.title")}
      titleIcon="refresh"
      contextTitle={vault.displayName}
      onClose={onClose}
      panelClassName="max-w-lg"
      footer={
        <ModalFooterActions layout="dialog">
          <Button label={t("action.cancel")} variant="ghost" size="sm" onPress={onClose} />
          <Button
            label={offers.remove ? t("recovery.remove") : t("action.continue")}
            variant={offers.remove ? "danger" : "primary"}
            size="sm"
            disabled={pending}
            onPress={runPrimary}
          />
        </ModalFooterActions>
      }
    >
      {pending ? null : offers.remove ? (
        <View style={styles.stack}>
          <Text style={typography.bodyMuted}>
            {t("recovery.hint_plain", { name: vault.displayName, since: leftover?.since ?? "" })}
          </Text>
          <Text style={typography.bodyMuted}>{t("recovery.remove_desc")}</Text>
        </View>
      ) : (
        <Text style={typography.bodyMuted}>{t("recovery.hint", { name: vault.displayName })}</Text>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
});
