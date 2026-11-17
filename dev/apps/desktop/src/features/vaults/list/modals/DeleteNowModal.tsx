import type { VaultListItem } from "@upriv/shared";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";

interface DeleteNowModalProps {
  /** The vault whose delete ends early; `null` keeps the window closed. */
  vault: VaultListItem | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Delete now always asks first: the files it has not reached go without an
 * overwrite, so their bytes stay on the disk until it reuses the space.
 */
export function DeleteNowModal({ vault, onCancel, onConfirm }: DeleteNowModalProps) {
  const { t } = useTranslation();
  return (
    <Modal
      open={vault !== null}
      title={t("modal.delete_now.title")}
      titleIcon="trash"
      contextTitle={vault?.displayName}
      onClose={onCancel}
      panelClassName="max-w-md"
      rootClassName="z-[130]"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t("action.cancel")}
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm}>
            {t("modal.delete_now.confirm")}
          </Button>
        </div>
      }
    >
      <p className="text-sm leading-relaxed text-on-surface-variant">
        {t("modal.delete_now.body")}
      </p>
    </Modal>
  );
}
