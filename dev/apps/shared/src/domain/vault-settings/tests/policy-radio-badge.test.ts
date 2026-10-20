import { describe, expect, it } from "vitest";
import { policyRadioBadgeList } from "../policyRadioBadge";

describe("policyRadioBadgeList", () => {
  it("is empty without a badge", () => {
    expect(policyRadioBadgeList(undefined)).toEqual([]);
  });

  it("wraps one badge and keeps the order of several", () => {
    expect(policyRadioBadgeList("default")).toEqual(["default"]);
    expect(policyRadioBadgeList(["in-use", "default"])).toEqual(["in-use", "default"]);
  });
});
