import type { ReactNode } from "react";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import {
  vaultRecoveryCase,
  type PlainLeftover,
  type PlainRecoveryAction,
  type VaultListItem,
} from "@upriv/shared";

interface VaultRecoveryModalProps {
  vault: VaultListItem | null;
  leftover: PlainLeftover | null | undefined;
  open: boolean;
  onClose: () => void;
  onAction: (action: PlainRecoveryAction) => void;
  /** Finish a password change that left files on an earlier key (the Password screen). */
  onFinishPasswordChange: () => void;
  /** Delete a vault whose import was cut off (the Delete vault window). */
  onDelete: () => void;
}

/**
 * Why a vault is in recovery, and its way out (`vaultRecoveryCase`):
 * - A leftover plain-text folder: the warning is the only step. The button
 *   starts the wipe and this window closes; the row shows `recovering`.
 * - A password change that left files on an earlier key: Finish, on the
 *   Password screen, or an unlock that leaves it for later.
 * - An import a quit or a crash cut off: an unlock keeps what got in, or the
 *   Delete vault window removes it.
 * - A password change that did not finish: the unlock asks for the new password.
 * - A close that did not finish: unlock the store as it is.
 */
export function VaultRecoveryModal({
  vault,
  leftover,
  open,
  onClose,
  onAction,
  onFinishPasswordChange,
  onDelete,
}: VaultRecoveryModalProps) {
  const { t } = useTranslation();

  if (!open || !vault) return null;

  const recovery = vaultRecoveryCase(vault, leftover);
  const resume = () => onAction({ kind: "resume_store" });
  const text = (body: string) => (
    <p className="text-sm leading-relaxed text-on-surface-variant">{body}</p>
  );

  let actions: ReactNode;
  let body: ReactNode = null;
  switch (recovery) {
    case "loading":
      actions = (
        <Button variant="primary" size="sm" disabled>
          {t("action.continue")}
        </Button>
      );
      break;
    case "remove_folder":
      actions = (
        <Button variant="danger" size="sm" onClick={() => onAction({ kind: "remove_folder" })}>
          {t("recovery.remove")}
        </Button>
      );
      body = (
        <div className="space-y-3">
          {text(
            t("recovery.hint_plain", { name: vault.displayName, since: leftover?.since ?? "" }),
          )}
          {text(t("recovery.remove_desc"))}
        </div>
      );
      break;
    case "finish_password_change":
      actions = (
        <>
          <Button variant="secondary" size="sm" onClick={resume}>
            {t("action.unlock")}
          </Button>
          <Button variant="primary" size="sm" onClick={onFinishPasswordChange}>
            {t("recovery.finish_password_change")}
          </Button>
        </>
      );
      body = (
        <div className="space-y-3">
          {text(t("vault.change_password.unfinished"))}
          {text(t("recovery.finish_password_change_hint"))}
        </div>
      );
      break;
    case "import_unfinished":
      actions = (
        <>
          <Button variant="secondary" size="sm" onClick={onDelete}>
            {t("modal.delete_vault.title")}
          </Button>
          <Button variant="primary" size="sm" onClick={resume}>
            {t("recovery.keep_import")}
          </Button>
        </>
      );
      body = (
        <div className="space-y-3">
          {text(t("recovery.import_unfinished", { name: vault.displayName }))}
          {text(t("recovery.import_unfinished_hint"))}
        </div>
      );
      break;
    case "password_change_pending":
    case "unfinished_close":
      actions = (
        <Button variant="primary" size="sm" onClick={resume}>
          {t("action.continue")}
        </Button>
      );
      body = text(
        recovery === "password_change_pending"
          ? t("unlock.password_change_pending")
          : t("recovery.hint", { name: vault.displayName }),
      );
      break;
  }

  return (
    <Modal
      open={open}
      title={t("recovery.title")}
      titleIcon="refresh"
      contextTitle={vault.displayName}
      onClose={onClose}
      panelClassName="max-w-lg"
      footer={<div className="flex flex-wrap justify-end gap-2">{actions}</div>}
    >
      {body}
    </Modal>
  );
}
