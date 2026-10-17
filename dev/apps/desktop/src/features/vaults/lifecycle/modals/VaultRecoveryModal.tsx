import { useEffect, useId, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { PolicyRadioOption } from "@/components/settings";
import { useTranslation } from "@/i18n";
import {
  plainRecoveryOffers,
  storageModeIsPlaintext,
  type PlainLeftover,
  type PlainRecoveryAction,
  type VaultListItem,
} from "@upriv/shared";

type Choice = "resume_store" | "remove_folder" | "new_vault";

interface VaultRecoveryModalProps {
  vault: VaultListItem | null;
  leftover: PlainLeftover | null | undefined;
  open: boolean;
  submitting?: boolean;
  onClose: () => void;
  onAction: (action: PlainRecoveryAction) => void;
}

/**
 * Dirty-close recovery.
 * Encrypted, or a plaintext vault with no leftover folder: unlock the store.
 * A leftover folder: Remove (default) or save it as a new vault.
 */
export function VaultRecoveryModal({
  vault,
  leftover,
  open,
  submitting = false,
  onClose,
  onAction,
}: VaultRecoveryModalProps) {
  const { t } = useTranslation();
  const choiceGroup = useId();
  const confirmId = useId();
  const nameId = useId();
  const passwordId = useId();
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
      panelClassName="max-w-lg"
      footer={
        view === "actions" ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={submitting} onClick={onClose}>
              {t("action.cancel")}
            </Button>
            <Button variant="primary" size="sm" disabled={submitting || pending} onClick={runPrimary}>
              {submitting ? t("close.dialog.submitting") : t("action.continue")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={submitting}
              onClick={() => setView("actions")}
            >
              {t("action.cancel")}
            </Button>
            {view === "remove_confirm" ? (
              <Button
                variant="danger"
                size="sm"
                disabled={!canRemove || submitting}
                onClick={() => onAction({ kind: "remove_folder" })}
              >
                {submitting ? t("close.dialog.submitting") : t("recovery.remove")}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                disabled={!canCreate || submitting}
                onClick={() =>
                  onAction({
                    kind: "new_vault",
                    displayName: displayName.trim(),
                    password,
                  })
                }
              >
                {submitting ? t("close.dialog.submitting") : t("recovery.new_vault")}
              </Button>
            )}
          </div>
        )
      }
    >
      {view === "remove_confirm" ? (
        <div className="space-y-3">
          <label htmlFor={confirmId} className="block text-sm text-on-surface-variant">
            {t("recovery.remove_confirm")}
          </label>
          <p className="font-mono text-xs text-on-surface-variant">{vault.id}</p>
          <input
            id={confirmId}
            type="text"
            value={typedId}
            onChange={(event) => setTypedId(event.target.value)}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border-0 bg-surface-container-highest px-3 py-2.5 text-sm text-on-surface outline-none ring-1 ring-outline-variant/40 focus:ring-accent/50"
          />
        </div>
      ) : null}
      {view === "new_vault" ? (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-on-surface-variant">
            {t("recovery.new_vault_desc")}
          </p>
          <label htmlFor={nameId} className="block text-sm text-on-surface-variant">
            {t("recovery.new_vault_name")}
          </label>
          <input
            id={nameId}
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoFocus
            className="w-full rounded-lg border-0 bg-surface-container-highest px-3 py-2.5 text-sm text-on-surface outline-none ring-1 ring-outline-variant/40 focus:ring-accent/50"
          />
          <label htmlFor={passwordId} className="block text-sm text-on-surface-variant">
            {t("recovery.new_vault_password")}
          </label>
          <input
            id={passwordId}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            className="w-full rounded-lg border-0 bg-surface-container-highest px-3 py-2.5 text-sm text-on-surface outline-none ring-1 ring-outline-variant/40 focus:ring-accent/50"
          />
        </div>
      ) : null}
      {view === "actions" && !pending && offers.remove ? (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-on-surface-variant">
            {t("recovery.hint_plain", {
              name: vault.displayName,
              since: leftover?.since ?? "",
            })}
          </p>
          <div role="radiogroup" aria-label={t("recovery.title")} className="grid gap-2">
            <PolicyRadioOption
              groupName={choiceGroup}
              value="remove_folder"
              checked={choice === "remove_folder"}
              title={t("recovery.remove")}
              description={t("recovery.remove_desc")}
              badge="recommended"
              onSelect={() => setChoice("remove_folder")}
            />
            {offers.create ? (
              <PolicyRadioOption
                groupName={choiceGroup}
                value="new_vault"
                checked={choice === "new_vault"}
                title={t("recovery.new_vault")}
                description={t("recovery.new_vault_desc")}
                onSelect={() => setChoice("new_vault")}
              />
            ) : null}
          </div>
        </div>
      ) : null}
      {view === "actions" && !pending && !offers.remove ? (
        <p className="text-sm leading-relaxed text-on-surface-variant">
          {t("recovery.hint", { name: vault.displayName })}
        </p>
      ) : null}
    </Modal>
  );
}
