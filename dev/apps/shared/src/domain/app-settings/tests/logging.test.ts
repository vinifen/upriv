import { describe, expect, it } from "vitest";
import {
  LOG_ENTRIES_PER_FILE,
  LOG_KEEP_LAST_DEFAULT,
  logFileCountForKeepLast,
  normalizeLogKeepLastEntries,
  normalizeLogLevel,
} from "../logging";

describe("normalizeLogLevel", () => {
  it("reads each level in any case and maps anything else to info", () => {
    expect(normalizeLogLevel("ERROR")).toBe("error");
    expect(normalizeLogLevel(" Warn ")).toBe("warn");
    expect(normalizeLogLevel("trace")).toBe("info");
    expect(normalizeLogLevel(undefined)).toBe("info");
  });
});

describe("normalizeLogKeepLastEntries", () => {
  it("keeps unlimited and known cadences", () => {
    expect(normalizeLogKeepLastEntries(0)).toBe(0);
    expect(normalizeLogKeepLastEntries(10_000)).toBe(10_000);
    expect(normalizeLogKeepLastEntries(12_345)).toBe(LOG_KEEP_LAST_DEFAULT);
  });
});

describe("logFileCountForKeepLast", () => {
  it("rounds up to whole files", () => {
    expect(logFileCountForKeepLast(0)).toBe(0);
    expect(logFileCountForKeepLast(LOG_ENTRIES_PER_FILE)).toBe(1);
    expect(logFileCountForKeepLast(LOG_ENTRIES_PER_FILE + 1)).toBe(2);
  });
});
