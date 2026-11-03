import { ExportFolderField } from "@/components/ExportFolderField";
import { Button, JobProgressBar, JobStopButton } from "@/components/ui";
import type { ExportFolder } from "@/hooks/useExportFolder";
import { useTranslation } from "@/i18n";
import { BACKUP_EXPORT_PROGRESS_COPY, exportFolderIssue } from "@upriv/shared";
import type { BackupExportJob } from "@upriv/shared/react";

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
          {t("modal.backup.export_confirm")}
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

/** How far this export got, how long it has run, and its stop. */
export function BackupExportProgress({ job, title, onStop }: BackupExportProgressProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      {title ? <p className="text-sm font-medium text-on-surface">{title}</p> : null}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <JobProgressBar
            progress={job.progress}
            startedAt={job.startedAt}
            label={t("modal.backup.export")}
            copy={BACKUP_EXPORT_PROGRESS_COPY}
          />
        </div>
        <span className="shrink-0">
          <JobStopButton
            size="sm"
            stoppingSince={job.stoppingSince}
            stoppable={job.progress?.stoppable ?? true}
            onStop={onStop}
            label={t("modal.backup.export_stop")}
            stoppingLabel={t("modal.backup.export_stopping")}
          />
        </span>
      </div>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("modal.backup.export_background_note")}
      </p>
    </div>
  );
}
