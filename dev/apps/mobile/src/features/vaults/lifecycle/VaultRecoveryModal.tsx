import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  plainRecoveryOffers,
  storageModeIsPlaintext,
  type PlainLeftover,
  type PlainRecoveryAction,
  type VaultListItem,
} from "@upriv/shared";
import { Button, Modal, ModalFooterActions } from "@/components/ui";
import { PolicyRadioOption, ThemedInput } from "@/components/settings";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";

type Choice = "resume_store" | "remove_folder" | "new_vault";

interface VaultRecoveryModalProps {
  vault: VaultListItem | null;
  leftover: PlainLeftover | null | undefined;
  open: boolean;
  submitting?: boolean;
  onClose: () => void;
  onAction: (action: PlainRecoveryAction) => void;
}

/** Dirty-close recovery. A leftover plaintext folder offers Remove or a new vault. */
export function VaultRecoveryModal({
  vault,
  leftover,
  open,
  submitting = false,
  onClose,
  onAction,
}: VaultRecoveryModalProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const isPlain = vault ? storageModeIsPlaintext(vault.storageMode) : false;
  const pending = isPlain && leftover === undefined;
  const offers = plainRecoveryOffers(pending ? null : (leftover ?? null));
  const [choice, setChoice] = useState<Choice>(offers.defaultChoice);
  const [view, setView] = useState<"actions" | "remove_confirm" | "new_vault">("actions");
  const [typedId, setTypedId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!open) {
      setChoice(offers.defaultChoice);
      setView("actions");
      setTypedId("");
      setDisplayName("");
      setPassword("");
    }
  }, [open, vault?.id, offers.defaultChoice]);

  if (!open || !vault) return null;

  const canRemove = typedId.trim() === vault.id;
  const canCreate = displayName.trim().length > 0 && password.trim().length >= 4;

  const runPrimary = () => {
    if (submitting || pending) return;
    if (choice === "remove_folder") {
      setView("remove_confirm");
      return;
    }
    if (choice === "new_vault") {
      setView("new_vault");
      return;
    }
    onAction({ kind: "resume_store" });
  };

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
        view === "actions" ? (
          <ModalFooterActions layout="dialog">
            <Button
              label={t("action.cancel")}
              variant="ghost"
              size="sm"
              disabled={submitting}
              onPress={onClose}
            />
            <Button
              label={submitting ? t("close.dialog.submitting") : t("action.continue")}
              variant="primary"
              size="sm"
              disabled={submitting || pending}
              onPress={runPrimary}
            />
          </ModalFooterActions>
        ) : (
          <ModalFooterActions layout="dialog">
            <Button
              label={t("action.cancel")}
              variant="ghost"
              size="sm"
              disabled={submitting}
              onPress={() => setView("actions")}
            />
            {view === "remove_confirm" ? (
              <Button
                label={submitting ? t("close.dialog.submitting") : t("recovery.remove")}
                variant="danger"
                size="sm"
                disabled={!canRemove || submitting}
                onPress={() => onAction({ kind: "remove_folder" })}
              />
            ) : (
              <Button
                label={submitting ? t("close.dialog.submitting") : t("recovery.new_vault")}
                variant="primary"
                size="sm"
                disabled={!canCreate || submitting}
                onPress={() =>
                  onAction({
                    kind: "new_vault",
                    displayName: displayName.trim(),
                    password,
                  })
                }
              />
            )}
          </ModalFooterActions>
        )
      }
    >
      {view === "remove_confirm" ? (
        <View style={styles.stack}>
          <Text style={typography.bodyMuted}>{t("recovery.remove_confirm")}</Text>
          <Text style={[typography.mono, { color: colors.onSurfaceVariant }]}>{vault.id}</Text>
          <ThemedInput
            value={typedId}
            onChangeText={setTypedId}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
          />
        </View>
      ) : null}
      {view === "new_vault" ? (
        <View style={styles.stack}>
          <Text style={typography.bodyMuted}>{t("recovery.new_vault_desc")}</Text>
          <Text style={typography.bodyMuted}>{t("recovery.new_vault_name")}</Text>
          <ThemedInput value={displayName} onChangeText={setDisplayName} autoFocus />
          <Text style={typography.bodyMuted}>{t("recovery.new_vault_password")}</Text>
          <ThemedInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
          />
        </View>
      ) : null}
      {view === "actions" && !pending && offers.remove ? (
        <View style={styles.stack}>
          <Text style={typography.bodyMuted}>
            {t("recovery.hint_plain", { name: vault.displayName, since: leftover?.since ?? "" })}
          </Text>
          <View accessibilityRole="radiogroup" style={styles.actions}>
            <PolicyRadioOption
              value="remove_folder"
              checked={choice === "remove_folder"}
              title={t("recovery.remove")}
              description={t("recovery.remove_desc")}
              badge="recommended"
              onSelect={() => setChoice("remove_folder")}
            />
            {offers.create ? (
              <PolicyRadioOption
                value="new_vault"
                checked={choice === "new_vault"}
                title={t("recovery.new_vault")}
                description={t("recovery.new_vault_desc")}
                onSelect={() => setChoice("new_vault")}
              />
            ) : null}
          </View>
        </View>
      ) : null}
      {view === "actions" && !pending && !offers.remove ? (
        <Text style={typography.bodyMuted}>{t("recovery.hint", { name: vault.displayName })}</Text>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  actions: { gap: spacing.sm },
});
