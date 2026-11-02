import type { JobProgressCopy } from "../jobs/progress";

/** A backup export while its file is written: bytes of the chosen backups done of the total. */
export const BACKUP_EXPORT_PROGRESS_COPY: JobProgressCopy = {
  measuring: "modal.backup.export_measuring",
  copying: "modal.backup.export_progress",
  finishing: "modal.backup.export_finishing",
};
