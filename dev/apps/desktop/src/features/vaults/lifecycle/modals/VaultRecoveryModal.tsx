import { useEffect, useId, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import type { VaultListItem } from "@upriv/shared";
import { isTauri } from "@/lib/tauri/invoke";
import {
  assessVaultRecovery,
  shortHashLabel,
  type RecoveryInfoDto,
} from "@/platform/tauri/vaultRecoveryService";

export type RecoveryAction = "use_store" | "reimport_archive" | "compare" | "discard_workspace";

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
  const [view, setView] = useState<"actions" | "compare" | "discard_confirm">("actions");
  const [discardText, setDiscardText] = useState("");
  const [compareInfo, setCompareInfo] = useState<RecoveryInfoDto | null>(null);

  useEffect(() => {
    if (!open) {
      setView("actions");
      setDiscardText("");
      setCompareInfo(null);
    }
  }, [open, vault?.id]);

  useEffect(() => {
    if (!open || !vault || !isTauri()) return;
    let cancelled = false;
    void assessVaultRecovery(vault.id)
      .then((info) => {
        if (!cancelled) setCompareInfo(info);
      })
      .catch(() => {
        if (!cancelled) setCompareInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, vault?.id]);

  if (!open || !vault) return null;

  const canConfirmDiscard = discardText.trim() === vault.id;
  const manifestArchive = compareInfo?.manifestArchiveHash ?? "—";
  const actualArchive = compareInfo?.actualArchiveHash ?? "—";
  const manifestStore = compareInfo?.manifestStoreHash ?? "—";
  const actualStore = compareInfo?.actualStoreHash ?? "—";
  const archiveMismatch = compareInfo?.archiveHashMismatch ?? false;
  const storeMismatch = compareInfo?.storeHashMismatch ?? false;

  return (
    <Modal
      open={open}
      title={t("recovery.title")}
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
        ) : view === "compare" ? (
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={() => setView("actions")}>
              {t("action.back")}
            </Button>
          </div>
        ) : null
      }
    >
      {view === "compare" ? (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-on-surface-variant">
            {t("recovery.compare_help")}
          </p>
          <dl className="space-y-2 rounded-lg bg-surface-container p-3 font-mono text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">{t("recovery.compare_archive_hash")}</dt>
              <dd
                className={`truncate ${archiveMismatch ? "text-on-error-container" : "text-on-surface"}`}
              >
                {shortHashLabel(actualArchive)}
                {archiveMismatch ? ` ≠ ${shortHashLabel(manifestArchive)}` : ""}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">{t("recovery.compare_store_hash")}</dt>
              <dd
                className={`truncate ${storeMismatch ? "text-on-error-container" : "text-on-surface"}`}
              >
                {shortHashLabel(actualStore)}
                {storeMismatch ? ` ≠ ${shortHashLabel(manifestStore)}` : ""}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">{t("recovery.compare_last_close")}</dt>
              <dd className="text-on-surface">{compareInfo?.lastCloseOkAt ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">{t("recovery.compare_store_write")}</dt>
              <dd
                className={
                  compareInfo?.storeAheadOfClose ? "text-on-error-container" : "text-on-surface"
                }
              >
                {compareInfo?.lastStoreWriteAt ?? "—"}
              </dd>
            </div>
          </dl>
          {(compareInfo?.needsRecovery ?? false) ? (
            <p className="text-xs text-on-error-container">{t("recovery.compare_mismatch")}</p>
          ) : null}
        </div>
      ) : view === "discard_confirm" ? (
        <div className="space-y-3">
          <p className="text-sm text-on-surface-variant">{t("recovery.discard_confirm")}</p>
          <p className="font-mono text-xs text-on-surface-variant">{vault.id}</p>
          <input
            id={discardConfirmId}
            type="text"
            value={discardText}
            onChange={(e) => setDiscardText(e.target.value)}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border-0 bg-surface-container-highest px-3 py-2.5 text-sm text-on-surface outline-none ring-1 ring-outline-variant/40 focus:ring-accent/50"
          />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-on-surface-variant">
            {t("recovery.hint", { name: vault.displayName })}
          </p>
          {compareInfo?.orphanWorkspace ? (
            <p className="text-xs text-on-error-container">{t("recovery.orphan_workspace")}</p>
          ) : null}
          <div className="grid gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={submitting}
              className="justify-start"
              onClick={() => onAction("use_store")}
            >
              {t("recovery.use_store")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={submitting}
              className="justify-start"
              onClick={() => onAction("reimport_archive")}
            >
              {t("recovery.reimport_archive")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={submitting}
              className="justify-start"
              onClick={() => setView("compare")}
            >
              {t("recovery.compare")}
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
