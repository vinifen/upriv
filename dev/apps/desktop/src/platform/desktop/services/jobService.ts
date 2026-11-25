import type { JobService } from "@upriv/shared";
import { rpcJobCancel, rpcJobSkipBackup, rpcJobStatus } from "@/lib/rpc";

/** Desktop → daemon `job_status` / `job_cancel` / `job_skip_backup`. */
export const desktopJobService: JobService = {
  status: (job) => rpcJobStatus(job),
  cancel: (job, by) => rpcJobCancel(job, by),
  skipBackup: (job) => rpcJobSkipBackup(job),
};
