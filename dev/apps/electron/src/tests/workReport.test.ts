import { describe, expect, it } from "vitest";
import { IDLE_WORK, parseWorkReport, workKeepsAwake } from "../workReport";

describe("parseWorkReport", () => {
  it("reads the jobs and the closing vaults", () => {
    expect(parseWorkReport({ jobs: 2, closing: 1 })).toEqual({ jobs: 2, closing: 1 });
  });

  it("reads anything malformed as no work", () => {
    expect(parseWorkReport(null)).toEqual(IDLE_WORK);
    expect(parseWorkReport("2")).toEqual(IDLE_WORK);
    expect(parseWorkReport({ jobs: -1, closing: 1.5 })).toEqual(IDLE_WORK);
    expect(parseWorkReport({ jobs: "3" })).toEqual(IDLE_WORK);
  });
});

describe("workKeepsAwake", () => {
  it("keeps the computer awake while a job runs or a vault closes", () => {
    expect(workKeepsAwake({ jobs: 1, closing: 0 })).toBe(true);
    expect(workKeepsAwake({ jobs: 0, closing: 1 })).toBe(true);
    expect(workKeepsAwake(IDLE_WORK)).toBe(false);
  });
});
