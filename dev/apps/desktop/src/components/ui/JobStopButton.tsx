import { useState } from "react";
import { ROW_ROLE_GUARD_MS } from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { Button } from "./Button";
import { ElapsedTime } from "./ElapsedTime";

interface JobStopButtonProps {
  /** When Stop was asked for; the button then says Stopping… and counts. */
  stoppingSince: number | null;
  /** False in the step the job cannot stop: the button is disabled and says why. */
  stoppable: boolean;
  onStop: () => void;
  /** Defaults to Stop / Stopping…. */
  label?: string;
  stoppingLabel?: string;
  size?: "sm" | "md";
}

/**
 * The Stop a window's footer shows in place of the button that started a job.
 * One press stops. Presses in its first `ROW_ROLE_GUARD_MS` are ignored, so
 * the second half of a double click on the start button never stops the job.
 * It is never a submit button, so Enter in a field cannot press it.
 */
export function JobStopButton({
  stoppingSince,
  stoppable,
  onStop,
  label,
  stoppingLabel,
  size = "md",
}: JobStopButtonProps) {
  const { t } = useTranslation();
  const [shownAt] = useState(() => Date.now());
  const stopping = stoppingSince !== null;
  return (
    <span className="inline-flex items-center gap-2">
      {stopping ? <ElapsedTime startedAt={stoppingSince} layout="inline" /> : null}
      <Button
        type="button"
        variant="secondary"
        size={size}
        disabled={stopping || !stoppable}
        title={!stopping && !stoppable ? t("action.stop_final") : undefined}
        onClick={() => {
          if (Date.now() - shownAt < ROW_ROLE_GUARD_MS) return;
          onStop();
        }}
      >
        {stopping ? (stoppingLabel ?? t("vault.status.stopping")) : (label ?? t("action.stop"))}
      </Button>
    </span>
  );
}
