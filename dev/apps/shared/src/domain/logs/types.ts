/** Rotated log file on disk under `.upriv/logs/`. */
export interface AppLogFile {
  filename: string;
  seq: number;
  isCurrent: boolean;
  /** ISO-8601 from filename timestamp. */
  createdAt: string;
  sizeBytes: number;
  lineCount: number;
  content: string;
}
