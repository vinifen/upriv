import type { AppLogFile } from "./types";

/** Parse one `log_list` / `log_get` file object (daemon camelCase wire). */
export function parseAppLogFile(raw: unknown): AppLogFile {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("log file: expected object");
  }
  const record = raw as Record<string, unknown>;
  if (
    typeof record.filename !== "string" ||
    typeof record.seq !== "number" ||
    !Number.isFinite(record.seq) ||
    !Number.isInteger(record.seq) ||
    record.seq < 0 ||
    typeof record.isCurrent !== "boolean" ||
    typeof record.createdAt !== "string" ||
    typeof record.sizeBytes !== "number" ||
    !Number.isFinite(record.sizeBytes) ||
    typeof record.lineCount !== "number" ||
    !Number.isFinite(record.lineCount) ||
    typeof record.lineCountExact !== "boolean"
  ) {
    throw new Error("log file: invalid shape");
  }
  return {
    filename: record.filename,
    seq: record.seq,
    isCurrent: record.isCurrent,
    createdAt: record.createdAt,
    sizeBytes: record.sizeBytes,
    lineCount: record.lineCount,
    lineCountExact: record.lineCountExact,
    content: typeof record.content === "string" ? record.content : "",
  };
}
