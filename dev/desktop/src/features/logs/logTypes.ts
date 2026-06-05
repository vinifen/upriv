export type LogLevel = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR";

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

export interface ParsedLogLine {
  raw: string;
  index: string;
  timestamp: string;
  level: LogLevel | "UNKNOWN";
  event: string;
  fields: string;
}
