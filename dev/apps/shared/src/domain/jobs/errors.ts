import type { I18nKey } from "../../i18n/catalog";
import { isRpcError } from "../core-rpc/errors";

/** Job wire codes from `upriv-rpc` (`map_core_err`). */
export const JOB_ERROR_CODES = {
  /** `job_cancel` stopped the job, or Upriv is quitting. Its partial file was removed. */
  CANCELLED: "job_cancelled",
} as const;

export type JobErrorCode = (typeof JOB_ERROR_CODES)[keyof typeof JOB_ERROR_CODES];

const JOB_ERROR_I18N_KEYS = {
  [JOB_ERROR_CODES.CANCELLED]: "error.job_cancelled",
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
