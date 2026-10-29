import type { JobService } from "@upriv/shared";
import { rpcJobCancel, rpcJobStatus } from "@/lib/rpc";

/** Native → `upriv-ffi` `job_status` / `job_cancel`. */
export const nativeJobService: JobService = {
  status: (job) => rpcJobStatus(job),
  cancel: (job, by) => rpcJobCancel(job, by),
};
