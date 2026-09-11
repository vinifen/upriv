import type { ParsedLogLine } from "./parsed";

/** Semantic tone for a parsed log line — apps map this to Tailwind classes or RN colors. */
export type LogLevelTone = "error" | "warn" | "info" | "debug" | "default";

export function logLevelTone(level: ParsedLogLine["level"]): LogLevelTone {
  switch (level) {
    case "ERROR":
      return "error";
    case "WARN":
      return "warn";
    case "INFO":
      return "info";
    case "DEBUG":
      return "debug";
    default:
      return "default";
  }
}
