import type { LogLevel, ParsedLogLine } from "./logTypes";

const LOG_LINE_RE = /^(\d{4})\s+(\S+)\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+(\S+)(?:\s+(.*))?$/;

/** Parse `000001-20260529120000.log` or `current-000002-20260529200000.log` → ISO UTC. */
export function logCreatedAtFromFilename(filename: string): string | null {
  const match = filename.match(/(?:current-)?\d{6}-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.log$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

export function formatLogFileDate(iso: string, locale: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(parsed));
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
    level: level as LogLevel,
    event,
    fields: fields.trim(),
  };
}

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
