import { describe, expect, it } from "vitest";
import { parsePendingPlainConfirm, parsePlainCloseSummary, plainRecoveryOffers } from "..";

describe("parsePendingPlainConfirm", () => {
  it("reads the folder core is waiting to write", () => {
    expect(
      parsePendingPlainConfirm({
        pendingPlainConfirm: { path: "/data/workspace/Notes", class: "cloud" },
      }),
    ).toEqual({ path: "/data/workspace/Notes", class: "cloud" });
  });

  it("treats a finished open as no confirm", () => {
    expect(parsePendingPlainConfirm(null)).toBeNull();
    expect(parsePendingPlainConfirm({})).toBeNull();
  });
});

describe("plainRecoveryOffers", () => {
  it("wipes the folder when it is still there", () => {
    expect(
      plainRecoveryOffers({
        path: "/data/workspace/Notes",
        since: "2026-01-01T00:00:00Z",
        found: true,
        files: 2,
        bytes: 10,
      }),
    ).toEqual({ remove: true });
  });

  it("offers unlock when no leftover folder is on this computer", () => {
    expect(plainRecoveryOffers(null)).toEqual({ remove: false });
    expect(
      plainRecoveryOffers({
        path: "/gone",
        since: "2026-01-01T00:00:00Z",
        found: false,
        files: 0,
        bytes: 0,
      }),
    ).toEqual({ remove: false });
  });
});

describe("parsePlainCloseSummary", () => {
  it("keeps the counts close reports", () => {
    expect(
      parsePlainCloseSummary({
        saved: 1,
        conflicts: 0,
        heldDeletions: 2,
        wiped: 3,
        kept: 0,
        totals: { added: 1, changed: 0, removed: 0 },
        backupPinned: true,
      })?.backupPinned,
    ).toBe(true);
  });
});
