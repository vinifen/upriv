import {
  jobProgressLine,
  jobProgressPercent,
  type JobProgress,
  type JobProgressCopy,
} from "@upriv/shared";
import { useTranslation } from "@/i18n";

interface JobProgressBarProps {
  /** `null` until core first answers `job_status`. */
  progress: JobProgress | null;
  /** Names the bar for assistive technology. */
  label: string;
  copy: JobProgressCopy;
}

/** How far a running job got: a bar, then a line with the bytes done of the total. */
export function JobProgressBar({ progress, label, copy }: JobProgressBarProps) {
  const { t } = useTranslation();
  const percent = jobProgressPercent(progress);
  const line = jobProgressLine(progress, copy);

  return (
    <>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        className="h-2 overflow-hidden rounded-full bg-surface-container-highest"
      >
        <div
          className={[
            "h-full rounded-full bg-accent transition-[width] duration-500",
            percent === null ? "w-1/4 animate-pulse" : "",
          ].join(" ")}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <p className="text-sm text-on-surface" role="status">
        {t(line.key, line.params)}
      </p>
    </>
  );
}
