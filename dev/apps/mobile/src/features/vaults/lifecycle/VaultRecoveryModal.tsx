import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { VaultListItem } from "@upriv/shared";
import { Button, Modal, ModalFooterActions } from "@/components/ui";
import { ThemedInput } from "@/components/settings";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";

export type RecoveryAction = "resume_contents" | "create_from_backup" | "discard_workspace";

interface VaultRecoveryModalProps {
  vault: VaultListItem | null;
  open: boolean;
  submitting?: boolean;
  onClose: () => void;
  onAction: (action: RecoveryAction) => void;
}

/** Desktop `VaultRecoveryModal` parity — resume / backup / discard workspace. */
export function VaultRecoveryModal({
  vault,
  open,
  submitting = false,
  onClose,
  onAction,
}: VaultRecoveryModalProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const [view, setView] = useState<"actions" | "discard_confirm">("actions");
  const [discardText, setDiscardText] = useState("");

  useEffect(() => {
    if (!open) {
      setView("actions");
      setDiscardText("");
    }
  }, [open, vault?.id]);

  if (!open || !vault) return null;

  const canConfirmDiscard = discardText.trim() === vault.id;

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
        ) : null
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
      ) : (
        <View style={styles.stack}>
          <Text style={typography.bodyMuted}>
            {t("recovery.hint", { name: vault.displayName })}
          </Text>
          <View style={styles.actions}>
            <Button
              label={t("recovery.resume_contents")}
              variant="primary"
              size="sm"
              disabled={submitting}
              onPress={() => onAction("resume_contents")}
            />
            <Button
              label={t("recovery.create_from_backup")}
              variant="secondary"
              size="sm"
              disabled={submitting}
              onPress={() => onAction("create_from_backup")}
            />
            <Button
              label={t("recovery.discard_workspace")}
              variant="ghost"
              size="sm"
              disabled={submitting}
              onPress={() => setView("discard_confirm")}
              style={{ borderColor: colors.errorContainer }}
            />
          </View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  actions: { gap: spacing.sm },
});
