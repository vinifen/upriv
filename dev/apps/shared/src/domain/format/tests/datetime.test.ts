import { describe, expect, it } from "vitest";
import { formatIsoDate } from "../datetime";

describe("formatIsoDate", () => {
  it("returns the original string when the timestamp is invalid", () => {
    expect(formatIsoDate("not-a-date", "en")).toBe("not-a-date");
  });

  it("formats a valid ISO timestamp", () => {
    const out = formatIsoDate("2026-05-28T12:00:00.000Z", "en");
    expect(out).not.toBe("2026-05-28T12:00:00.000Z");
    expect(out.length).toBeGreaterThan(0);
  });

  it("formats in each locale asked for, one after another", () => {
    const iso = "2026-05-28T12:00:00.000Z";
    for (const locale of ["en", "pt-BR", "es", "en"]) {
      const expected = new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(iso));
      expect(formatIsoDate(iso, locale)).toBe(expected);
    }
  });
});
