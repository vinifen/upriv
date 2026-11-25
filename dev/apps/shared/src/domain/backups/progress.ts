import type { JobProgressCopy } from "../jobs/progress";

/** A backup export while its file is written: bytes of the chosen backups done of the total. */
export const BACKUP_EXPORT_PROGRESS_COPY: JobProgressCopy = {
  measuring: "modal.backup.export_measuring",
  copying: "modal.backup.progress",
  finishing: "modal.backup.finishing",
};

/** Back up now while its zip is written: bytes of the vault's store done of the total. */
export const BACKUP_SAVE_PROGRESS_COPY: JobProgressCopy = {
  measuring: "modal.backup.backup_now_running",
  copying: "modal.backup.progress",
  finishing: "modal.backup.finishing",
};
