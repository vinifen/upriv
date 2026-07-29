import { describe, expect, it } from "vitest";
import {
  STORAGE_MODES,
  storageModeHasClosedCache,
  storageModeIsPlaintext,
  storageModeSealOnly,
} from "..";

describe("STORAGE_MODES", () => {
  it("lists all five product modes in UI order", () => {
    expect(STORAGE_MODES).toEqual([
      "encrypted_dir",
      "store_only",
      "ram_only",
      "plain",
      "plain_only",
    ]);
  });
});

describe("storageModeHasClosedCache", () => {
  it.each([
    ["encrypted_dir", true],
    ["store_only", true],
    ["ram_only", false],
    ["plain", false],
    ["plain_only", false],
  ] as const)("mode %s → %s", (mode, expected) => {
    expect(storageModeHasClosedCache(mode)).toBe(expected);
  });
});

describe("storageModeSealOnly", () => {
  it.each([
    ["plain", true],
    ["plain_only", true],
    ["ram_only", true],
    ["encrypted_dir", false],
    ["store_only", false],
  ] as const)("mode %s → %s", (mode, expected) => {
    expect(storageModeSealOnly(mode)).toBe(expected);
  });
});

describe("storageModeIsPlaintext", () => {
  it.each([
    ["plain", true],
    ["plain_only", true],
    ["encrypted_dir", false],
    ["store_only", false],
    ["ram_only", false],
  ] as const)("mode %s → %s", (mode, expected) => {
    expect(storageModeIsPlaintext(mode)).toBe(expected);
  });
});
