import { describe, expect, it } from "vitest";
import { parsePlainCloseSummary } from "..";

describe("parsePlainCloseSummary", () => {
  it("keeps the counts close reports", () => {
    expect(
      parsePlainCloseSummary({
        saved: 1,
        conflicts: 0,
        heldDeletions: 2,
        removed: 3,
        kept: 0,
        totals: { added: 1, changed: 0, removed: 0 },
        backupPinned: true,
      })?.backupPinned,
    ).toBe(true);
  });

  it("reports a leftover only when core says the folder holds one", () => {
    expect(parsePlainCloseSummary({ kept: 2, leftover: true })?.leftover).toBe(true);
    expect(parsePlainCloseSummary({ kept: 2 })?.leftover).toBe(false);
  });
});
