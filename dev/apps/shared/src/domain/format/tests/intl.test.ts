import { afterEach, describe, expect, it, vi } from "vitest";
import { formatIsoDate } from "../datetime";
import { baseCollator, deviceCollator, isoDateFormat } from "../intl";

const ISO = "2026-05-28T12:00:00.000Z";

function freshText(locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(ISO),
  );
}

// Node applies a new `TZ` to dates and Intl as soon as it is set.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("isoDateFormat", () => {
  it("keeps one formatter per locale while the device stays the same", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ISO));
    const english = isoDateFormat("en");
    vi.setSystemTime(Date.now() + 5_000);
    expect(isoDateFormat("en")).toBe(english);
    expect(isoDateFormat("pt-BR")).not.toBe(english);
    expect(isoDateFormat("pt-BR")).toBe(isoDateFormat("pt-BR"));
  });

  it("follows a time zone change within a second", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ISO));
    vi.stubEnv("TZ", "UTC");
    vi.setSystemTime(Date.now() + 1_000);
    const inUtc = formatIsoDate(ISO, "en");
    expect(inUtc).toBe(freshText("en"));

    vi.stubEnv("TZ", "America/Sao_Paulo");
    vi.setSystemTime(Date.now() + 1_000);
    const inSaoPaulo = formatIsoDate(ISO, "en");
    expect(inSaoPaulo).toBe(freshText("en"));
    expect(inSaoPaulo).not.toBe(inUtc);
    expect(isoDateFormat("en").resolvedOptions().timeZone).toBe("America/Sao_Paulo");
  });

  it("reads the device again when the clock is set back", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ISO));
    vi.stubEnv("TZ", "UTC");
    vi.setSystemTime(Date.now() + 1_000);
    expect(isoDateFormat("en").resolvedOptions().timeZone).toBe("UTC");
    vi.stubEnv("TZ", "Asia/Tokyo");
    vi.setSystemTime(Date.now() - 60_000);
    expect(isoDateFormat("en").resolvedOptions().timeZone).toBe("Asia/Tokyo");
  });
});

describe("collators", () => {
  const names = [
    "beta",
    "Álpha",
    "alpha",
    "Gamma",
    "ALPHA",
    "éclair",
    "Eclair",
    "zeta",
    "",
    "Beta",
  ];

  it("compare as localeCompare does", () => {
    for (const a of names) {
      for (const b of names) {
        expect(Math.sign(deviceCollator().compare(a, b))).toBe(Math.sign(a.localeCompare(b)));
        expect(Math.sign(baseCollator().compare(a, b))).toBe(
          Math.sign(a.localeCompare(b, undefined, { sensitivity: "base" })),
        );
      }
    }
  });

  it("are built once while the device stays the same", () => {
    expect(deviceCollator()).toBe(deviceCollator());
    expect(baseCollator()).toBe(baseCollator());
    expect(baseCollator()).not.toBe(deviceCollator());
  });
});
