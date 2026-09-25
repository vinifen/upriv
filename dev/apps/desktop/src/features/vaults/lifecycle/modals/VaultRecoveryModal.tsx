import { useEffect, useId, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { PolicyRadioOption } from "@/components/settings";
import { useTranslation } from "@/i18n";
import { storageModeIsPlaintext, type VaultListItem } from "@upriv/shared";

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
 * Dirty-close recovery.
 * - `encrypted_dir`: unlock the encrypted vault only (no discard / create-from-backup).
 * - `upriv_plain`: choose resume or wipe leftover plaintext workspace.
 */
export function VaultRecoveryModal({
  vault,
  open,
  submitting = false,
  onClose,
  onAction,
}: VaultRecoveryModalProps) {
  const { t } = useTranslation();
  const choiceGroup = useId();
  const discardConfirmId = useId();
  const discardHelpId = useId();
  const discardVaultId = useId();
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
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={submitting} onClick={onClose}>
              {t("action.cancel")}
            </Button>
            <Button variant="primary" size="sm" disabled={submitting} onClick={runPrimary}>
              {footerCtaLabel}
            </Button>
          </div>
        )
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
      ) : isPlain ? (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-on-surface-variant">
            {t("recovery.hint_plain", { name: vault.displayName })}
          </p>
          <div role="radiogroup" aria-label={t("recovery.title")} className="grid gap-2">
            <PolicyRadioOption
              groupName={choiceGroup}
              value="resume_store"
              checked={choice === "resume_store"}
              title={t("recovery.resume_store")}
              description={t("recovery.resume_store_desc")}
              badge="recommended"
              onSelect={() => setChoice("resume_store")}
            />
            <PolicyRadioOption
              groupName={choiceGroup}
              value="discard_workspace"
              checked={choice === "discard_workspace"}
              title={t("recovery.discard_workspace")}
              description={t("recovery.discard_workspace_desc")}
              tone="less-secure"
              onSelect={() => setChoice("discard_workspace")}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-on-surface-variant">
            {t("recovery.hint", { name: vault.displayName })}
          </p>
        </div>
      )}
    </Modal>
  );
}
