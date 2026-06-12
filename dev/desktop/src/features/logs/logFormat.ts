import type { ParsedLogLine } from "@upriv/shared";

/** Desktop-only Tailwind classes for log line levels. */
export function logLevelClass(level: ParsedLogLine["level"]): string {
  switch (level) {
    case "ERROR":
      return "text-on-error-container";
    case "WARN":
      return "text-vault-recovery";
    case "INFO":
      return "text-accent";
    case "DEBUG":
      return "text-on-surface-variant";
    case "TRACE":
      return "text-on-surface-variant/70";
    default:
      return "text-on-surface";
  }
}
