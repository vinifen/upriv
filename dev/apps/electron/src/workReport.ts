/**
 * What the renderer tells main whenever its running work changes: the jobs
 * running or queued (an export, an import, an open, …), and the vaults
 * closing. Main asks before quitting while either is above zero, waits for
 * the jobs on a normal quit, and keeps the computer awake meanwhile.
 */
export interface WorkReport {
  jobs: number;
  closing: number;
}

export const IDLE_WORK: WorkReport = { jobs: 0, closing: 0 };

function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

/** Anything malformed reads as no work. */
export function parseWorkReport(raw: unknown): WorkReport {
  if (typeof raw !== "object" || raw === null) return IDLE_WORK;
  const record = raw as { jobs?: unknown; closing?: unknown };
  return { jobs: count(record.jobs), closing: count(record.closing) };
}

/** Sleep would stall the work: keep the computer awake while any runs. */
export function workKeepsAwake(report: WorkReport): boolean {
  return report.jobs + report.closing > 0;
}
