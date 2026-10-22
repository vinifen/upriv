import type { JobService } from "@upriv/shared";
import { rpcJobCancel, rpcJobStatus } from "@/lib/rpc";

/** Desktop → daemon `job_status` / `job_cancel`. */
export const desktopJobService: JobService = {
  status: (job) => rpcJobStatus(job),
  cancel: (job, by) => rpcJobCancel(job, by),
};
