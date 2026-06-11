import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui";
import { VAULT_NOTE_MAX_LENGTH } from "@/constants/vault";
import { useTranslation } from "@/i18n";
import type { VaultListItem } from "./types";

const DEBOUNCE_MS = 400;
const SAVED_INDICATOR_MS = 1500;

function normalizeNote(note: string | undefined): string {
  return note ?? "";
}

interface VaultNoteModalProps {
  vault: VaultListItem | null;
  open: boolean;
  onClose: () => void;
  onNoteChange: (vaultId: string, note: string) => void;
}

export function VaultNoteModal({ vault, open, onClose, onNoteChange }: VaultNoteModalProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [savedVisible, setSavedVisible] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const savedHideRef = useRef<ReturnType<typeof setTimeout>>();

  const vaultId = vault?.id;
  const savedNote = normalizeNote(vault?.note);

  useEffect(() => {
    if (!open || !vaultId) return;
    setDraft(savedNote);
    setSavedVisible(false);
  }, [open, vaultId, savedNote]);

  const persistNote = useCallback(
    (note: string) => {
      if (!vaultId) return;
      const trimmed = normalizeNote(note).slice(0, VAULT_NOTE_MAX_LENGTH);
      onNoteChange(vaultId, trimmed);
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
        persistNote(trimmed);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [draft, open, vaultId, savedNote, persistNote]);

  const handleClose = useCallback(() => {
    if (vaultId) {
      clearTimeout(debounceRef.current);
      const trimmed = draft.slice(0, VAULT_NOTE_MAX_LENGTH);
      if (trimmed !== savedNote) {
        onNoteChange(vaultId, trimmed);
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
      title={t("modal.note.title", { name: vault.displayName })}
      onClose={handleClose}
    >
      <p className="mb-3 text-sm text-on-surface-variant">
        {t("vault.create.note_help", { max: VAULT_NOTE_MAX_LENGTH })}
      </p>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={VAULT_NOTE_MAX_LENGTH}
        rows={5}
        placeholder={t("modal.note.placeholder")}
        autoFocus
        className="w-full resize-y rounded-lg border-0 bg-surface-container px-3 py-2.5 text-sm text-on-surface shadow-none outline-none ring-0 placeholder:text-on-surface-variant/60 focus:border-0 focus:outline-none focus:ring-0"
      />
      <div className="mt-2 flex items-center justify-between text-xs text-on-surface-variant">
        <span
          className={savedVisible ? "text-vault-open transition-opacity" : "invisible"}
          aria-live="polite"
        >
          {t("modal.note.saved")}
        </span>
        <span className="font-mono tabular-nums">
          {draft.length}/{VAULT_NOTE_MAX_LENGTH}
        </span>
      </div>
    </Modal>
  );
}
