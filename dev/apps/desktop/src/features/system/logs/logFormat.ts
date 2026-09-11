import { logLevelTone, type ParsedLogLine } from "@upriv/shared";

const LOG_LEVEL_CLASS = {
  error: "text-on-error-container",
  warn: "text-vault-recovery",
  info: "text-accent",
  debug: "text-on-surface-variant",
  default: "text-on-surface",
} as const;

/** Desktop-only Tailwind classes for log line levels. */
export function logLevelClass(level: ParsedLogLine["level"]): string {
  return LOG_LEVEL_CLASS[logLevelTone(level)];
}
