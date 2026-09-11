import { describe, expect, it } from "vitest";
import { isWindowsReservedName } from "..";

describe("isWindowsReservedName", () => {
  it.each([
    ["con", true],
    ["CON", true],
    ["nul.txt", true],
    ["com9", true],
    ["LPT3", true],
    ["conx", false],
    ["", false],
    ["a.con", false],
  ] as const)("handles %s", (value, expected) => {
    expect(isWindowsReservedName(value)).toBe(expected);
  });
});
