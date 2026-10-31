import { ExportFolderField } from "@/components/ExportFolderField";
import { Button, JobProgressBar, LoadingBudgetHint } from "@/components/ui";
import type { ExportFolder } from "@/hooks/useExportFolder";
import { useTranslation } from "@/i18n";
import { exportFolderIssue, LOADING_BUDGET_MS, VAULT_EXPORT_PROGRESS_COPY } from "@upriv/shared";
import { useLoadingBudget, type BackupExportJob } from "@upriv/shared/react";

interface BackupExportFolderStepProps {
  folder: ExportFolder;
  /** Under the field's label: the file this export writes there. */
  hint: string;
  /** Names the backups when several go together. */
  title?: string;
  onConfirm: () => void;
  onCancel: () => void;
  onPicked: (folder: string) => void;
}

/** Where this export goes. A folder from the picker starts it; a kept or typed one waits. */
export function BackupExportFolderStep({
  folder,
  hint,
  title,
  onConfirm,
  onCancel,
  onPicked,
}: BackupExportFolderStepProps) {
  const { t } = useTranslation();
  const ready = !folder.picking && exportFolderIssue(folder.path) === null;

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm();
      }}
    >
      {title ? <p className="text-sm font-medium text-on-surface">{title}</p> : null}
      <ExportFolderField folder={folder} hint={hint} onPicked={onPicked} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("action.cancel")}
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={!ready}>
          {t("vault.export.dialog.confirm")}
        </Button>
      </div>
    </form>
  );
}

interface BackupExportProgressProps {
  job: BackupExportJob;
  /** Names the backups when several go together. */
  title?: string;
  onStop: () => void;
}

/** How far this export got, how long it may still take, and its stop. */
export function BackupExportProgress({ job, title, onStop }: BackupExportProgressProps) {
  const { t } = useTranslation();
  const budget = useLoadingBudget(true, LOADING_BUDGET_MS.backupExport, {
    startedAt: job.startedAt,
  });

  return (
    <div className="space-y-2">
      {title ? <p className="text-sm font-medium text-on-surface">{title}</p> : null}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <JobProgressBar
            progress={job.progress}
            label={t("vault.export.dialog.title")}
            copy={VAULT_EXPORT_PROGRESS_COPY}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          disabled={job.stopping}
          onClick={onStop}
        >
          {job.stopping ? t("vault.export.dialog.stopping") : t("vault.export.dialog.stop")}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("vault.export.dialog.background_note")}
      </p>
      {budget.visible ? (
        <LoadingBudgetHint
          budgetMs={budget.budgetMs}
          remainingMs={budget.remainingMs}
          layout="inline"
        />
      ) : null}
    </div>
  );
}
