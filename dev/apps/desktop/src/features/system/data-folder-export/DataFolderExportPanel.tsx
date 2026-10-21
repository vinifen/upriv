import { useId } from "react";
import { ExportFolderField } from "@/components/ExportFolderField";
import { SettingsField, settingsControlClass } from "@/components/settings";
import { JobProgressBar, LoadingBudgetHint } from "@/components/ui";
import { useTranslation } from "@/i18n";
import {
  DATA_FOLDER_EXPORT_PROGRESS_COPY,
  DATA_FOLDER_ZIP_NAME_MAX_BYTES,
  LOADING_BUDGET_MS,
  dataFolderZipNameFromInput,
  dataFolderZipNameIssue,
  dataFolderZipNameIssueI18nKey,
  fileNameOfPath,
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
 * Body of the Export a copy option in Data folder: what the zip is called and
 * where it goes, then the running copy, and a saved line once this window saw
 * the zip written. The window footer starts and stops it.
 */
export function DataFolderExportPanel({ controls, destination }: DataFolderExportPanelProps) {
  const { job, written } = controls;
  const { t } = useTranslation();
  const nameId = useId();
  const budget = useLoadingBudget(job !== null, LOADING_BUDGET_MS.dataFolderExport, {
    startedAt: job?.startedAt,
  });
  const nameIssue = dataFolderZipNameIssue(dataFolderZipNameFromInput(destination.zipName));
  const nameIssueKey = nameIssue ? dataFolderZipNameIssueI18nKey(nameIssue) : null;

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("modal.data_folder_export.hold_note")}
      </p>
      {job ? (
        <div className="space-y-2">
          <JobProgressBar
            progress={job.progress}
            label={t("modal.data_folder_export.title")}
            copy={DATA_FOLDER_EXPORT_PROGRESS_COPY}
          />
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
          <ExportFolderField folder={destination.folder} />
          {written ? (
            <p className="text-sm text-vault-open" role="status">
              {t("modal.data_folder_export.done", { name: fileNameOfPath(written.path) })}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
