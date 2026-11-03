import type { I18nKey } from "../../i18n/catalog";
import { isRpcError } from "../core-rpc/errors";

/** Job wire codes from `upriv-rpc` (`map_core_err`). */
export const JOB_ERROR_CODES = {
  /** `job_cancel` stopped the job, or Upriv is quitting. What it wrote was removed. */
  CANCELLED: "job_cancelled",
  /** The job is in its last step, which always finishes: `job_cancel` refused. */
  NOT_STOPPABLE: "job_not_stoppable",
} as const;

export type JobErrorCode = (typeof JOB_ERROR_CODES)[keyof typeof JOB_ERROR_CODES];

const JOB_ERROR_I18N_KEYS = {
  [JOB_ERROR_CODES.CANCELLED]: "error.job_cancelled",
  [JOB_ERROR_CODES.NOT_STOPPABLE]: "error.job_not_stoppable",
} as const satisfies Record<JobErrorCode, I18nKey>;

const JOB_ERROR_CODE_VALUES = new Set<string>(Object.values(JOB_ERROR_CODES));

export function isJobErrorCode(code: string): code is JobErrorCode {
  return JOB_ERROR_CODE_VALUES.has(code);
}

export function jobErrorI18nKey(code: JobErrorCode): I18nKey {
  return JOB_ERROR_I18N_KEYS[code];
}

/** The job was stopped: not a failure to report. */
export function isJobCancelled(error: unknown): boolean {
  return isRpcError(error) && error.code === JOB_ERROR_CODES.CANCELLED;
}
