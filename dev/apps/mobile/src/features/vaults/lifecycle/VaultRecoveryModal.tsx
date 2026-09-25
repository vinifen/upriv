import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { storageModeIsPlaintext, type VaultListItem } from "@upriv/shared";
import { Button, Modal, ModalFooterActions } from "@/components/ui";
import { PolicyRadioOption, ThemedInput } from "@/components/settings";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";

export type RecoveryAction = "resume_store" | "discard_workspace";

type PlainChoice = RecoveryAction;

interface VaultRecoveryModalProps {
  vault: VaultListItem | null;
  open: boolean;
  submitting?: boolean;
  onClose: () => void;
  onAction: (action: RecoveryAction) => void;
}

/**
 * Dirty-close recovery — desktop `VaultRecoveryModal` parity.
 * - `encrypted_dir`: unlock the encrypted vault only.
 * - `upriv_plain`: resume or wipe leftover plaintext workspace.
 */
export function VaultRecoveryModal({
  vault,
  open,
  submitting = false,
  onClose,
  onAction,
}: VaultRecoveryModalProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const [choice, setChoice] = useState<PlainChoice>("resume_store");
  const [view, setView] = useState<"actions" | "discard_confirm">("actions");
  const [discardText, setDiscardText] = useState("");

  const isPlain = vault ? storageModeIsPlaintext(vault.storageMode) : false;

  useEffect(() => {
    if (!open) {
      setChoice("resume_store");
      setView("actions");
      setDiscardText("");
    }
  }, [open, vault?.id]);

  if (!open || !vault) return null;

  const canConfirmDiscard = discardText.trim() === vault.id;

  const runPrimary = () => {
    if (submitting) return;
    if (!isPlain) {
      onAction("resume_store");
      return;
    }
    if (choice === "discard_workspace") {
      setView("discard_confirm");
      return;
    }
    onAction("resume_store");
  };

  const footerCtaLabel = submitting
    ? t("close.dialog.submitting")
    : isPlain
      ? t("action.continue")
      : t("action.unlock");

  return (
    <Modal
      open={open}
      title={t("recovery.title")}
      titleIcon="refresh"
      contextTitle={vault.displayName}
      onClose={() => {
        if (!submitting) onClose();
      }}
      dismissible={!submitting}
      panelClassName="max-w-lg"
      footer={
        view === "discard_confirm" ? (
          <ModalFooterActions layout="dialog">
            <Button
              label={t("action.cancel")}
              variant="ghost"
              size="sm"
              disabled={submitting}
              onPress={() => setView("actions")}
            />
            <Button
              label={submitting ? t("close.dialog.submitting") : t("recovery.discard_workspace")}
              variant="danger"
              size="sm"
              disabled={!canConfirmDiscard || submitting}
              onPress={() => onAction("discard_workspace")}
            />
          </ModalFooterActions>
        ) : (
          <ModalFooterActions layout="dialog">
            <Button
              label={t("action.cancel")}
              variant="ghost"
              size="sm"
              disabled={submitting}
              onPress={onClose}
            />
            <Button
              label={footerCtaLabel}
              variant="primary"
              size="sm"
              disabled={submitting}
              onPress={runPrimary}
            />
          </ModalFooterActions>
        )
      }
    >
      {view === "discard_confirm" ? (
        <View style={styles.stack}>
          <Text style={typography.bodyMuted}>{t("recovery.discard_confirm")}</Text>
          <Text style={[typography.mono, { color: colors.onSurfaceVariant }]}>{vault.id}</Text>
          <ThemedInput
            value={discardText}
            onChangeText={setDiscardText}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
          />
        </View>
      ) : isPlain ? (
        <View style={styles.stack}>
          <Text style={typography.bodyMuted}>
            {t("recovery.hint_plain", { name: vault.displayName })}
          </Text>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={t("recovery.title")}
            style={styles.actions}
          >
            <PolicyRadioOption
              value="resume_store"
              checked={choice === "resume_store"}
              title={t("recovery.resume_store")}
              description={t("recovery.resume_store_desc")}
              badge="recommended"
              onSelect={() => setChoice("resume_store")}
            />
            <PolicyRadioOption
              value="discard_workspace"
              checked={choice === "discard_workspace"}
              title={t("recovery.discard_workspace")}
              description={t("recovery.discard_workspace_desc")}
              tone="less-secure"
              onSelect={() => setChoice("discard_workspace")}
            />
          </View>
        </View>
      ) : (
        <View style={styles.stack}>
          <Text style={typography.bodyMuted}>
            {t("recovery.hint", { name: vault.displayName })}
          </Text>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  actions: { gap: spacing.sm },
});
