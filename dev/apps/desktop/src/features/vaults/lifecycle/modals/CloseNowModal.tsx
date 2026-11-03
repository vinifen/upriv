import { useEffect, useState } from "react";
import {
  closeNowNoticeKeys,
  closeNowQuitNoticeKeys,
  storageModeIsPlaintext,
  type VaultListItem,
} from "@upriv/shared";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";

/** What Close now acts on: one vault, or every vault and job as Upriv quits. */
export type CloseNowTarget =
  | {
      kind: "vault";
      vault: VaultListItem;
      /** An editor tab in this vault has unsaved changes. */
      unsaved: boolean;
    }
  | { kind: "quit" };

interface CloseNowModalProps {
  target: CloseNowTarget | null;
  /** The setting is on, so "Don't ask again" has something to turn off. */
  asks: boolean;
  onCancel: () => void;
  onConfirm: (dontAskAgain: boolean) => void;
}

/**
 * What Close now skips, before it runs: the one window for a vault's Close now
 * and the quit's, with the same "Don't ask again" (`lifecycle_confirm_close_now`).
 */
export function CloseNowModal({ target, asks, onCancel, onConfirm }: CloseNowModalProps) {
  const { t } = useTranslation();
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const targetKey = target?.kind === "vault" ? `vault:${target.vault.id}` : (target?.kind ?? null);

  useEffect(() => {
    setDontAskAgain(false);
  }, [targetKey]);

  const quit = target?.kind === "quit";
  const notices =
    target?.kind === "vault"
      ? closeNowNoticeKeys(storageModeIsPlaintext(target.vault.storageMode))
      : closeNowQuitNoticeKeys();

  return (
    <Modal
      open={target !== null}
      title={t(quit ? "modal.close_now.quit_title" : "modal.close_now.title")}
      titleIcon="lock"
      contextTitle={target?.kind === "vault" ? target.vault.displayName : undefined}
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
      {target ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed text-on-surface-variant">
            {t(quit ? "modal.close_now.quit_intro" : "modal.close_now.intro")}
          </p>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-on-surface-variant">
            {notices.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
          {target.kind === "vault" && target.unsaved ? (
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
