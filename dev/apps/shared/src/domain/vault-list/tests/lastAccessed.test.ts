import { describe, expect, it } from "vitest";
import { formatIsoDate } from "../../format/datetime";
import { vaultLastAccessedLabel } from "../lastAccessed";

describe("vaultLastAccessedLabel", () => {
  it("prefers a localized ISO stamp over a relative mock label", () => {
    expect(
      vaultLastAccessedLabel(
        { lastAccessedAt: "2026-09-11T12:00:00.000Z", lastAccessedWhen: "2m ago" },
        "en",
      ),
    ).toBe(formatIsoDate("2026-09-11T12:00:00.000Z", "en"));
  });

  it("shows a dash when there is no stamp or label", () => {
    expect(vaultLastAccessedLabel({}, "en")).toBe("—");
  });

  it("falls back to the mock label when there is no ISO stamp", () => {
    expect(vaultLastAccessedLabel({ lastAccessedAt: "", lastAccessedWhen: "2m ago" }, "en")).toBe(
      "2m ago",
    );
  });
});
