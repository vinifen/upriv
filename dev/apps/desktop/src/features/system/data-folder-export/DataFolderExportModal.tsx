import { useState } from "react";
import { PathField } from "@/components/PathField";
import { SettingsField } from "@/components/settings";
import { Button, LoadingBudgetHint, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useVaultRootService } from "@/platform/services";
import {
  LOADING_BUDGET_MS,
  dataFolderExportPercent,
  dataFolderZipName,
  formatBytes,
  type VaultPathWriteResult,
} from "@upriv/shared";
import { useLoadingBudget, type DataFolderExportJob } from "@upriv/shared/react";

interface DataFolderExportModalProps {
  open: boolean;
  /** Every vault is closed or in recovery and no vault work runs (`dataFolderCanExport`). */
  canStart: boolean;
  /** The export in flight. The vault list keeps it while this window is closed. */
  job: DataFolderExportJob | null;
  /** The zip the last export wrote, until another one starts. */
  written: VaultPathWriteResult | null;
  onClose: () => void;
  onStart: (destDir: string) => void;
  onStop: () => void;
}

/** Settings → Export data folder: one zip of the whole `.upriv`. */
export function DataFolderExportModal({
  open,
  canStart,
  job,
  written,
  onClose,
  onStart,
  onStop,
}: DataFolderExportModalProps) {
  const { t } = useTranslation();
  const vaultRoot = useVaultRootService();
  const [destDir, setDestDir] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickFailed, setPickFailed] = useState(false);
  const budget = useLoadingBudget(job !== null, LOADING_BUDGET_MS.dataFolderExport, {
    startedAt: job?.startedAt,
  });

  if (!open) return null;

  const chooseFolder = async () => {
    setPicking(true);
    setPickFailed(false);
    try {
      const picked = await vaultRoot.pickFolder(
        destDir,
        t("modal.data_folder_export.picker_title"),
      );
      if (picked?.trim()) setDestDir(picked.trim());
    } catch {
      setPickFailed(true);
    } finally {
      setPicking(false);
    }
  };

  const progress = job?.progress ?? null;
  const percent = dataFolderExportPercent(progress);

  return (
    <Modal
      open={open}
      title={t("modal.data_folder_export.title")}
      titleIcon="archive"
      onClose={onClose}
      panelClassName="max-w-lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {job || written ? t("action.close") : t("action.cancel")}
          </Button>
          {job ? (
            <Button variant="secondary" size="sm" disabled={job.stopping} onClick={onStop}>
              {job.stopping
                ? t("modal.data_folder_export.stopping")
                : t("modal.data_folder_export.stop")}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              disabled={!canStart || !destDir || picking}
              onClick={() => {
                if (destDir) onStart(destDir);
              }}
            >
              {t("modal.data_folder_export.confirm")}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-on-surface-variant">
          {t("modal.data_folder_export.body")}
        </p>
        <p className="text-sm leading-relaxed text-on-surface-variant">
          {t("modal.data_folder_export.hold_note")}
        </p>
        {job ? (
          <div className="space-y-2">
            <div
              role="progressbar"
              aria-label={t("modal.data_folder_export.title")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? undefined}
              className="h-2 overflow-hidden rounded-full bg-surface-container-highest"
            >
              <div
                className={[
                  "h-full rounded-full bg-accent transition-[width] duration-500",
                  percent === null ? "w-1/4 animate-pulse" : "",
                ].join(" ")}
                style={percent === null ? undefined : { width: `${percent}%` }}
              />
            </div>
            <p className="text-sm text-on-surface" role="status">
              {progress && progress.bytesTotal > 0
                ? t("modal.data_folder_export.progress", {
                    done: formatBytes(progress.bytesDone),
                    total: formatBytes(progress.bytesTotal),
                  })
                : t("modal.data_folder_export.measuring")}
            </p>
            <p className="text-xs leading-relaxed text-on-surface-variant">
              {t("modal.data_folder_export.background_note")}
            </p>
            {budget.visible ? (
              <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
            ) : null}
          </div>
        ) : (
          <>
            <SettingsField
              label={t("modal.data_folder_export.folder_label")}
              hint={t("modal.data_folder_export.file_hint")}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                <PathField
                  className="sm:flex-1"
                  value={destDir ?? ""}
                  readOnly
                  placeholder={t("modal.data_folder_export.folder_none")}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  className="w-full shrink-0 sm:w-auto"
                  disabled={picking}
                  onClick={() => void chooseFolder()}
                >
                  {t("modal.data_folder_export.choose_folder")}
                </Button>
              </div>
            </SettingsField>
            {pickFailed ? (
              <p className="text-sm text-on-error-container">{t("error.unexpected")}</p>
            ) : null}
            {canStart ? null : (
              <p className="text-sm leading-relaxed text-on-error-container">
                {t("modal.data_folder_export.blocked")}
              </p>
            )}
            {written ? (
              <div className="space-y-1.5">
                <p className="text-sm text-vault-open">
                  {t("modal.data_folder_export.done", { name: dataFolderZipName(written.path) })}
                </p>
                <PathField value={written.path} readOnly />
              </div>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
