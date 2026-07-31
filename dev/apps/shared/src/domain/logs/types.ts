/** Rotated log file on disk under `.upriv/logs/`.
 *
 * Wire shape must match Rust `upriv_core::logging::LogFileInfo`
 * (`serde rename_all = "camelCase"`). Contract fixture: `tests/log-file-info.wire.json`.
 */
export interface AppLogFile {
  filename: string;
  seq: number;
  isCurrent: boolean;
  /** ISO-8601 UTC (`…T hh:mm:ss.000Z` from filename stamp when canonical). */
  createdAt: string;
  sizeBytes: number;
  lineCount: number;
  /** `false` when the daemon skipped counting (file too large to scan). */
  lineCountExact: boolean;
  content: string;
}
