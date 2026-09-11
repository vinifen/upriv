import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { VAULT_NOTE_MAX_LENGTH, type VaultListItem } from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import { Modal } from "@/components/ui";
import { ThemedInput } from "@/components/settings";

const DEBOUNCE_MS = 400;
const SAVED_INDICATOR_MS = 1500;

function normalizeNote(note: string | undefined): string {
  return note ?? "";
}

interface VaultNoteModalProps {
  vault: VaultListItem | null;
  open: boolean;
  onClose: () => void;
  onNoteChange: (vaultId: string, note: string) => Promise<boolean>;
}

export function VaultNoteModal({ vault, open, onClose, onNoteChange }: VaultNoteModalProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const [draft, setDraft] = useState("");
  const [savedVisible, setSavedVisible] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const savedHideRef = useRef<ReturnType<typeof setTimeout>>();

  const vaultId = vault?.id;
  const savedNote = normalizeNote(vault?.note);
  const vaultRef = useRef(vault);
  vaultRef.current = vault;

  useEffect(() => {
    if (!open || !vaultId) return;
    setDraft(normalizeNote(vaultRef.current?.note));
    setSavedVisible(false);
  }, [open, vaultId]);

  const persistNote = useCallback(
    async (note: string): Promise<void> => {
      if (!vaultId) return;
      const trimmed = normalizeNote(note).slice(0, VAULT_NOTE_MAX_LENGTH);
      const persisted = await onNoteChange(vaultId, trimmed);
      if (!persisted) return;
      setSavedVisible(true);
      clearTimeout(savedHideRef.current);
      savedHideRef.current = setTimeout(() => setSavedVisible(false), SAVED_INDICATOR_MS);
    },
    [vaultId, onNoteChange],
  );

  useEffect(() => {
    if (!open || !vaultId) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const trimmed = draft.slice(0, VAULT_NOTE_MAX_LENGTH);
      if (trimmed !== savedNote) {
        void persistNote(trimmed);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [draft, open, vaultId, savedNote, persistNote]);

  const handleClose = useCallback(() => {
    if (vaultId) {
      clearTimeout(debounceRef.current);
      const trimmed = draft.slice(0, VAULT_NOTE_MAX_LENGTH);
      if (trimmed !== savedNote) {
        void onNoteChange(vaultId, trimmed);
      }
    }
    onClose();
  }, [vaultId, draft, savedNote, onNoteChange, onClose]);

  useEffect(() => {
    return () => {
      clearTimeout(debounceRef.current);
      clearTimeout(savedHideRef.current);
    };
  }, []);

  if (!open || !vault) return null;

  return (
    <Modal
      open={open}
      title={t("modal.note.title")}
      titleIcon="note"
      contextTitle={vault.displayName}
      onClose={handleClose}
    >
      <Text style={[typography.bodyMuted, styles.help]}>
        {t("vault.create.note_help", { max: VAULT_NOTE_MAX_LENGTH })}
      </Text>
      <ThemedInput
        value={draft}
        onChangeText={setDraft}
        maxLength={VAULT_NOTE_MAX_LENGTH}
        placeholder={t("modal.note.placeholder")}
        multiline
        autoFocus
        textAlignVertical="top"
        style={styles.input}
      />
      <View style={styles.savedRow}>
        <Text
          style={[
            typography.caption,
            { color: savedVisible ? colors.vaultStatusOpen : "transparent" },
          ]}
          accessibilityLiveRegion="polite"
        >
          {t("modal.note.saved")}
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  help: { marginBottom: spacing.md },
  input: { minHeight: 160, textAlignVertical: "top" },
  savedRow: { marginTop: spacing.sm },
});
