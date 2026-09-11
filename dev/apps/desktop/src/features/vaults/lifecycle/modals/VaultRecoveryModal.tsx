import { useEffect, useId, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import type { VaultListItem } from "@upriv/shared";

export type RecoveryAction = "resume_contents" | "create_from_backup" | "discard_workspace";

interface VaultRecoveryModalProps {
  vault: VaultListItem | null;
  open: boolean;
  submitting?: boolean;
  onClose: () => void;
  onAction: (action: RecoveryAction) => void;
}

export function VaultRecoveryModal({
  vault,
  open,
  submitting = false,
  onClose,
  onAction,
}: VaultRecoveryModalProps) {
  const { t } = useTranslation();
  const discardConfirmId = useId();
  const discardHelpId = useId();
  const discardVaultId = useId();
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
      panelClassName="max-w-lg"
      footer={
        view === "discard_confirm" ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={submitting}
              onClick={() => setView("actions")}
            >
              {t("action.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!canConfirmDiscard || submitting}
              onClick={() => onAction("discard_workspace")}
            >
              {submitting ? t("close.dialog.submitting") : t("recovery.discard_workspace")}
            </Button>
          </div>
        ) : null
      }
    >
      {view === "discard_confirm" ? (
        <div className="space-y-3">
          <label
            htmlFor={discardConfirmId}
            id={discardHelpId}
            className="block text-sm text-on-surface-variant"
          >
            {t("recovery.discard_confirm")}
          </label>
          <p id={discardVaultId} className="font-mono text-xs text-on-surface-variant">
            {vault.id}
          </p>
          <input
            id={discardConfirmId}
            type="text"
            value={discardText}
            onChange={(e) => setDiscardText(e.target.value)}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${discardHelpId} ${discardVaultId}`}
            className="w-full rounded-lg border-0 bg-surface-container-highest px-3 py-2.5 text-sm text-on-surface outline-none ring-1 ring-outline-variant/40 focus:ring-accent/50"
          />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-on-surface-variant">
            {t("recovery.hint", { name: vault.displayName })}
          </p>
          <div className="grid gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={submitting}
              className="justify-start"
              onClick={() => onAction("resume_contents")}
            >
              {t("recovery.resume_contents")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={submitting}
              className="justify-start"
              onClick={() => onAction("create_from_backup")}
            >
              {t("recovery.create_from_backup")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={submitting}
              className="justify-start text-on-error-container hover:bg-error-container/15"
              onClick={() => setView("discard_confirm")}
            >
              {t("recovery.discard_workspace")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
