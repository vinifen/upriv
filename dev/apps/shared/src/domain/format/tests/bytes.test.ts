import { describe, expect, it } from "vitest";
import { formatBytes } from "..";

describe("formatBytes", () => {
  it.each([
    [undefined, "—"],
    [Number.NaN, "—"],
    [512, "512 B"],
    [2048, "2.0 KB"],
    [5 * 1024 * 1024, "5.0 MB"],
    [2 * 1024 * 1024 * 1024, "2.00 GB"],
  ] as const)("formats %s as %s", (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });
});
