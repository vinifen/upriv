import type { JobService } from "@upriv/shared";
import { rpcJobCancel, rpcJobSkipBackup, rpcJobStatus } from "@/lib/rpc";

/** Native → `upriv-ffi` `job_status` / `job_cancel` / `job_skip_backup`. */
export const nativeJobService: JobService = {
  status: (job) => rpcJobStatus(job),
  cancel: (job, by) => rpcJobCancel(job, by),
  skipBackup: (job) => rpcJobSkipBackup(job),
};
