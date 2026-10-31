import { useEffect, useState } from "react";
import { closeNowNoticeKeys, storageModeIsPlaintext, type VaultListItem } from "@upriv/shared";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";

interface CloseNowModalProps {
  vault: VaultListItem | null;
  /** An editor tab in this vault has unsaved changes. */
  unsaved: boolean;
  /** The setting is on, so "Don't ask again" has something to turn off. */
  asks: boolean;
  onCancel: () => void;
  onConfirm: (dontAskAgain: boolean) => void;
}

/** What Close now skips, before it runs. */
export function CloseNowModal({ vault, unsaved, asks, onCancel, onConfirm }: CloseNowModalProps) {
  const { t } = useTranslation();
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const vaultId = vault?.id;

  useEffect(() => {
    setDontAskAgain(false);
  }, [vaultId]);

  return (
    <Modal
      open={vault !== null}
      title={t("modal.close_now.title")}
      titleIcon="lock"
      contextTitle={vault?.displayName}
      onClose={onCancel}
      panelClassName="max-w-md"
      rootClassName="z-[130]"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t("action.cancel")}
          </Button>
          <Button variant="danger" size="sm" onClick={() => onConfirm(dontAskAgain)}>
            {t("modal.close_now.confirm")}
          </Button>
        </div>
      }
    >
      {vault ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed text-on-surface-variant">
            {t("modal.close_now.intro")}
          </p>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-on-surface-variant">
            {closeNowNoticeKeys(storageModeIsPlaintext(vault.storageMode)).map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
          {unsaved ? (
            <p className="text-sm font-medium leading-relaxed text-on-surface">
              {t("modal.close_now.unsaved")}
            </p>
          ) : null}
          {asks ? (
            <div className="flex flex-col gap-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-on-surface-variant">
                <input
                  type="checkbox"
                  checked={dontAskAgain}
                  onChange={(event) => setDontAskAgain(event.target.checked)}
                  className="h-4 w-4 shrink-0 rounded border-outline-variant/50 bg-surface-container-high text-accent focus:ring-accent/40"
                />
                {t("modal.close_now.dont_ask")}
              </label>
              {dontAskAgain ? (
                <p className="text-xs leading-relaxed text-on-surface-variant">
                  {t("modal.close_now.dont_ask_hint")}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
