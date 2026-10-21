import type { I18nKey } from "../../i18n/catalog";
import type { I18nParams } from "../../i18n/types";
import { formatBytes } from "../format/bytes";

/** How far a running job got (`job_status`). */
export interface JobProgress {
  bytesDone: number;
  /** `0` until the job has measured its work. */
  bytesTotal: number;
}

/** Wire `job_status`. `null` once the job ended, or before it started. */
export function parseJobStatus(raw: unknown): JobProgress | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as { running?: unknown; bytesDone?: unknown; bytesTotal?: unknown };
  if (record.running !== true) return null;
  const bytesDone = typeof record.bytesDone === "number" ? record.bytesDone : 0;
  const bytesTotal = typeof record.bytesTotal === "number" ? record.bytesTotal : 0;
  return { bytesDone, bytesTotal };
}

/** Whole percent done, or `null` while the work is still being measured. */
export function jobProgressPercent(progress: JobProgress | null): number | null {
  if (!progress || progress.bytesTotal <= 0) return null;
  const ratio = Math.min(1, Math.max(0, progress.bytesDone / progress.bytesTotal));
  return Math.floor(ratio * 100);
}

/**
 * Every byte is copied and the job is still running: it is flushing the file
 * to disk, checking it, and moving it into place.
 */
export function jobProgressFinishing(progress: JobProgress | null): boolean {
  return progress !== null && progress.bytesTotal > 0 && progress.bytesDone >= progress.bytesTotal;
}

/** The lines a running job shows. `copying` takes `{done}` and `{total}`. */
export interface JobProgressCopy {
  measuring: I18nKey;
  copying: I18nKey;
  finishing: I18nKey;
}

/** What a running job shows now: still measuring, the bytes done of the total, or finishing. */
export function jobProgressLine(
  progress: JobProgress | null,
  copy: JobProgressCopy,
): { key: I18nKey; params?: I18nParams } {
  if (jobProgressFinishing(progress)) return { key: copy.finishing };
  if (progress && progress.bytesTotal > 0) {
    return {
      key: copy.copying,
      params: { done: formatBytes(progress.bytesDone), total: formatBytes(progress.bytesTotal) },
    };
  }
  return { key: copy.measuring };
}
