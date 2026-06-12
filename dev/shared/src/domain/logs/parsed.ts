/** Parsed line level from rotated log files (uppercase in file format). */
export type ParsedLogLevel = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface ParsedLogLine {
  raw: string;
  index: string;
  timestamp: string;
  level: ParsedLogLevel | "UNKNOWN";
  event: string;
  fields: string;
}
