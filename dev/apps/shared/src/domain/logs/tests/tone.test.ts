import { describe, expect, it } from "vitest";
import { logLevelTone } from "../tone";

describe("logLevelTone", () => {
  it.each([
    ["ERROR", "error"],
    ["WARN", "warn"],
    ["INFO", "info"],
    ["DEBUG", "debug"],
    ["UNKNOWN", "default"],
  ] as const)("%s → %s", (level, expected) => {
    expect(logLevelTone(level)).toBe(expected);
  });
});
