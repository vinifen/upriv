import { useId } from "react";
import { PathField } from "@/components/PathField";
import { SettingsField, settingsControlClass } from "@/components/settings";
import { Button, LoadingBudgetHint } from "@/components/ui";
import { useTranslation } from "@/i18n";
import {
  DATA_FOLDER_ZIP_NAME_MAX_BYTES,
  LOADING_BUDGET_MS,
  dataFolderExportPending,
  dataFolderZipName,
  dataFolderZipNameFromInput,
  dataFolderZipNameIssue,
  dataFolderZipNameIssueI18nKey,
  formatBytes,
  jobProgressFinishing,
  jobProgressPercent,
} from "@upriv/shared";
import { useLoadingBudget } from "@upriv/shared/react";
import type {
  DataFolderExportControls,
  DataFolderExportDestination,
} from "./dataFolderExportTypes";

interface DataFolderExportPanelProps {
  controls: DataFolderExportControls;
  destination: DataFolderExportDestination;
}

/**
 * Body of the Export a copy option in Data folder, shown once it is chosen:
 * what the zip is called and where it goes, then the running copy. The window
 * footer starts and stops it.
 */
export function DataFolderExportPanel({ controls, destination }: DataFolderExportPanelProps) {
  const { job, written } = controls;
  const { t } = useTranslation();
  const nameId = useId();
  const folderId = useId();
  const folderNotAbsolute =
    dataFolderExportPending(destination.destDir, destination.zipName) === "folder_not_absolute";
  const budget = useLoadingBudget(job !== null, LOADING_BUDGET_MS.dataFolderExport, {
    startedAt: job?.startedAt,
  });
  const progress = job?.progress ?? null;
  const percent = jobProgressPercent(progress);
  const nameIssue = dataFolderZipNameIssue(dataFolderZipNameFromInput(destination.zipName));
  const nameIssueKey = nameIssue ? dataFolderZipNameIssueI18nKey(nameIssue) : null;

  const progressLine = () => {
    if (jobProgressFinishing(progress)) return t("modal.data_folder_export.finishing");
    if (progress && progress.bytesTotal > 0) {
      return t("modal.data_folder_export.progress", {
        done: formatBytes(progress.bytesDone),
        total: formatBytes(progress.bytesTotal),
      });
    }
    return t("modal.data_folder_export.measuring");
  };

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-on-surface-variant">
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
            {progressLine()}
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
            label={t("modal.data_folder_export.name_label")}
            hint={t("modal.data_folder_export.name_hint")}
            htmlFor={nameId}
          >
            <div className="flex items-center gap-2">
              <input
                id={nameId}
                type="text"
                value={destination.zipName}
                maxLength={DATA_FOLDER_ZIP_NAME_MAX_BYTES}
                aria-invalid={nameIssueKey ? true : undefined}
                onChange={(event) => destination.setZipName(event.target.value)}
                className={[settingsControlClass, "font-mono"].join(" ")}
                autoComplete="off"
                spellCheck={false}
              />
              <span className="shrink-0 font-mono text-sm text-on-surface-variant">.zip</span>
            </div>
            {nameIssueKey ? (
              <p className="text-xs leading-relaxed text-on-error-container" role="alert">
                {t(nameIssueKey)}
              </p>
            ) : null}
          </SettingsField>
          <SettingsField label={t("modal.data_folder_export.folder_label")} htmlFor={folderId}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
              <PathField
                id={folderId}
                className="sm:flex-1"
                value={destination.destDir ?? ""}
                onChange={destination.setDestDir}
                invalid={folderNotAbsolute}
                placeholder={t("modal.folder_field.placeholder")}
              />
              <Button
                type="button"
                variant="secondary"
                size="md"
                className="w-full shrink-0 sm:w-auto"
                disabled={destination.picking}
                onClick={destination.choose}
              >
                {t("modal.data_folder_export.choose_folder")}
              </Button>
            </div>
            {folderNotAbsolute ? (
              <p className="text-xs leading-relaxed text-on-error-container" role="alert">
                {t("modal.workspace.error.not_absolute")}
              </p>
            ) : null}
          </SettingsField>
          {destination.pickFailed ? (
            <p className="text-sm text-on-error-container" role="alert">
              {t("error.unexpected")}
            </p>
          ) : null}
          {written ? (
            <div className="space-y-1.5">
              <p className="text-sm text-vault-open">
                {t("modal.data_folder_export.done", {
                  name: dataFolderZipName(written.result.path),
                })}
              </p>
              <PathField value={written.result.path} readOnly />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
