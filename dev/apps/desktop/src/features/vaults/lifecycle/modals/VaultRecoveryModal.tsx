import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import {
  plainRecoveryOffers,
  storageModeIsPlaintext,
  type PlainLeftover,
  type PlainRecoveryAction,
  type VaultListItem,
} from "@upriv/shared";

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
 * A leftover folder: the warning is the only step. The button wipes it.
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
  const isPlain = vault ? storageModeIsPlaintext(vault.storageMode) : false;
  const pending = isPlain && leftover === undefined;
  const offers = plainRecoveryOffers(pending ? null : (leftover ?? null));

  if (!open || !vault) return null;

  const runPrimary = () => {
    if (submitting || pending) return;
    onAction(offers.remove ? { kind: "remove_folder" } : { kind: "resume_store" });
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
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={submitting} onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button
            variant={offers.remove ? "danger" : "primary"}
            size="sm"
            disabled={submitting || pending}
            onClick={runPrimary}
          >
            {submitting
              ? t("close.dialog.submitting")
              : offers.remove
                ? t("recovery.remove")
                : t("action.continue")}
          </Button>
        </div>
      }
    >
      {pending ? null : offers.remove ? (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-on-surface-variant">
            {t("recovery.hint_plain", {
              name: vault.displayName,
              since: leftover?.since ?? "",
            })}
          </p>
          <p className="text-sm leading-relaxed text-on-surface-variant">
            {t("recovery.remove_desc")}
          </p>
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-on-surface-variant">
          {t("recovery.hint", { name: vault.displayName })}
        </p>
      )}
    </Modal>
  );
}
