import type { ReactNode } from "react";
import { formatElapsed } from "@upriv/shared";
import { useElapsed } from "@upriv/shared/react";
import { useTranslation } from "@/i18n";

interface ElapsedTimeProps {
  /** When the work started; `null` shows nothing (queued, or no counter). */
  startedAt: number | null;
  /** `inline`: the time alone, for a vault row or a progress line. `block`: a line under a spinner. */
  layout?: "block" | "inline";
  /** Shown instead until the counter appears (a row's last-accessed text). */
  fallback?: ReactNode;
}

/** How long long work has been running, from one second in. Never an estimate. */
export function ElapsedTime({ startedAt, layout = "block", fallback = null }: ElapsedTimeProps) {
  const { t } = useTranslation();
  const elapsed = useElapsed(startedAt);
  if (!elapsed?.visible) return fallback;
  const time = formatElapsed(elapsed.elapsedMs);
  const label = t("loading.elapsed", { time });
  if (layout === "inline") {
    return (
      <span
        className="shrink-0 font-mono text-xs tabular-nums text-on-surface-variant"
        title={label}
        aria-label={label}
      >
        {time}
      </span>
    );
  }
  return <p className="mt-3 text-xs leading-relaxed text-on-surface-variant/90">{label}</p>;
}
