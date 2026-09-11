import { describe, expect, it } from "vitest";
import { backupCreatedAtFromStamp } from "../format";

describe("backupCreatedAtFromStamp", () => {
  it("parses a stamp prefix into UTC ISO", () => {
    expect(backupCreatedAtFromStamp("20260528T120000")).toBe("2026-05-28T12:00:00Z");
    expect(backupCreatedAtFromStamp("20260528T120000-notes")).toBe("2026-05-28T12:00:00Z");
  });

  it("returns null when the prefix is not a stamp", () => {
    expect(backupCreatedAtFromStamp("latest")).toBeNull();
    expect(backupCreatedAtFromStamp("")).toBeNull();
  });
});
