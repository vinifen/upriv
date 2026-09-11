import { logLevelTone, type ParsedLogLine } from "@upriv/shared";
import type { ThemeColors } from "@/theme/tokens";

const LOG_LEVEL_COLOR = {
  error: (c: ThemeColors) => c.onErrorContainer,
  warn: (c: ThemeColors) => c.vaultStatusRecovery,
  info: (c: ThemeColors) => c.accent,
  debug: (c: ThemeColors) => c.onSurfaceVariant,
  default: (c: ThemeColors) => c.onSurface,
} as const;

/** Shared `logLevelTone` mapped onto theme tokens. */
export function logLevelColor(level: ParsedLogLine["level"], colors: ThemeColors): string {
  return LOG_LEVEL_COLOR[logLevelTone(level)](colors);
}
