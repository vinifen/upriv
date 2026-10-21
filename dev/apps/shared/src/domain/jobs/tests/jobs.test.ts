import { describe, expect, it } from "vitest";
import { RpcError } from "../../core-rpc/errors";
import { errorDisplayI18nKey } from "../../errors";
import { JOB_ERROR_CODES, isJobCancelled } from "../errors";
import { newJobId } from "../jobId";
import { jobProgressFinishing, jobProgressPercent, parseJobStatus } from "../progress";

/** Same rule as core `is_valid_job_id`. */
const CORE_JOB_ID = /^[A-Za-z0-9_-]{1,64}$/;

describe("newJobId", () => {
  it("is never reused and fits the ids core takes", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const id = newJobId();
      expect(id).toMatch(CORE_JOB_ID);
      ids.add(id);
    }
    expect(ids.size).toBe(500);
  });
});

describe("parseJobStatus", () => {
  it("reads a running job", () => {
    expect(parseJobStatus({ running: true, bytesDone: 5, bytesTotal: 10 })).toEqual({
      bytesDone: 5,
      bytesTotal: 10,
    });
  });

  it("is null when the job does not run or the answer is not an object", () => {
    expect(parseJobStatus({ running: false, bytesDone: 0, bytesTotal: 0 })).toBeNull();
    expect(parseJobStatus(null)).toBeNull();
    expect(parseJobStatus("running")).toBeNull();
  });
});

describe("jobProgressPercent", () => {
  it("is null until the work is measured", () => {
    expect(jobProgressPercent(null)).toBeNull();
    expect(jobProgressPercent({ bytesDone: 0, bytesTotal: 0 })).toBeNull();
  });

  it("rounds down and stays within 0 to 100", () => {
    expect(jobProgressPercent({ bytesDone: 1, bytesTotal: 3 })).toBe(33);
    expect(jobProgressPercent({ bytesDone: 3, bytesTotal: 3 })).toBe(100);
    expect(jobProgressPercent({ bytesDone: 9, bytesTotal: 3 })).toBe(100);
  });
});

describe("jobProgressFinishing", () => {
  it("holds once every byte is copied and the job still runs", () => {
    expect(jobProgressFinishing({ bytesDone: 3, bytesTotal: 3 })).toBe(true);
    expect(jobProgressFinishing({ bytesDone: 2, bytesTotal: 3 })).toBe(false);
    expect(jobProgressFinishing({ bytesDone: 0, bytesTotal: 0 })).toBe(false);
    expect(jobProgressFinishing(null)).toBe(false);
  });
});

describe("job errors", () => {
  it("recognize a stop", () => {
    expect(isJobCancelled(new RpcError(JOB_ERROR_CODES.CANCELLED, "x"))).toBe(true);
    expect(isJobCancelled(new RpcError("io_error", "x"))).toBe(false);
    expect(isJobCancelled(new Error("x"))).toBe(false);
  });

  it("map a stop to its message", () => {
    expect(errorDisplayI18nKey(new RpcError(JOB_ERROR_CODES.CANCELLED, "x"))).toBe(
      "error.job_cancelled",
    );
  });
});
