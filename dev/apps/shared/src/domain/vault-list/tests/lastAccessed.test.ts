import { describe, expect, it } from "vitest";
import { formatIsoDate } from "../../format/datetime";
import { formatLastAccessedWhen, vaultLastAccessedLabel } from "../lastAccessed";

describe("formatLastAccessedWhen", () => {
  it("returns a dash when the stamp is missing", () => {
    expect(formatLastAccessedWhen("", "en")).toBe("—");
    expect(formatLastAccessedWhen(undefined, "en")).toBe("—");
  });

  it("formats a valid ISO stamp", () => {
    expect(formatLastAccessedWhen("2026-09-11T12:00:00.000Z", "en")).toBe(
      formatIsoDate("2026-09-11T12:00:00.000Z", "en"),
    );
  });
});

describe("vaultLastAccessedLabel", () => {
  it("prefers a localized ISO stamp over a relative mock label", () => {
    expect(
      vaultLastAccessedLabel(
        { lastAccessedAt: "2026-09-11T12:00:00.000Z", lastAccessedWhen: "2m ago" },
        "en",
      ),
    ).toBe(formatIsoDate("2026-09-11T12:00:00.000Z", "en"));
  });

  it("falls back to the mock label when there is no ISO stamp", () => {
    expect(vaultLastAccessedLabel({ lastAccessedAt: "", lastAccessedWhen: "2m ago" }, "en")).toBe(
      "2m ago",
    );
  });
});
