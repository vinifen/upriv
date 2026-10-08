import { formatIsoDate } from "../format/datetime";
import type { AppLogFile } from "./types";
import type { ParsedLogLevel, ParsedLogLine } from "./parsed";

const LOG_LINE_RE = /^(\d{4})\s+(\S+)\s+(DEBUG|INFO|WARN|ERROR)\s+(\S+)(?:\s+(.*))?$/;
// Line index is 4 digits (0001–1000) — matches Rust writer cap in `LogConfig::effective_entries_per_file`.

/** Parse `000001-20260529120000.log` or `current-000002-20260529200000.log` → ISO UTC (`.000Z`). */
export function logCreatedAtFromFilename(filename: string): string | null {
  const match = filename.match(
    /(?:current-)?\d{6}-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.log$/,
  );
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
}

export function formatLogFileDate(iso: string, locale: string): string {
  return formatIsoDate(iso, locale);
}

export function parseLogLine(line: string): ParsedLogLine {
  const trimmed = line.trimEnd();
  const match = trimmed.match(LOG_LINE_RE);
  if (!match) {
    return {
      raw: trimmed,
      index: "",
      timestamp: "",
      level: "UNKNOWN",
      event: trimmed,
      fields: "",
    };
  }

  const [, index, timestamp, level, event, fields = ""] = match;
  return {
    raw: trimmed,
    index,
    timestamp,
    level: level as ParsedLogLevel,
    event,
    fields: fields.trim(),
  };
}

/** Newest / active log first — matches list UX in Logs modal. */
export function compareLogFilesNewestFirst(a: AppLogFile, b: AppLogFile): number {
  if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return tb - ta;
  if (a.seq !== b.seq) return b.seq - a.seq;
  return a.filename.localeCompare(b.filename);
}

/**
 * Lowest and highest `seq` among `filenames` (used to name a multi-file delete).
 * `null` when any of them has no sequence number, so the range never misstates the selection.
 */
export function logSeqRange(
  files: readonly AppLogFile[],
  filenames: readonly string[],
): { first: number; last: number } | null {
  const wanted = new Set(filenames);
  const seqs = files.filter((file) => wanted.has(file.filename)).map((file) => file.seq);
  if (seqs.length !== wanted.size || seqs.some((seq) => seq <= 0)) return null;
  return { first: Math.min(...seqs), last: Math.max(...seqs) };
}

export function sortLogFilesNewestFirst(files: readonly AppLogFile[]): AppLogFile[] {
  return [...files].sort(compareLogFilesNewestFirst);
}
