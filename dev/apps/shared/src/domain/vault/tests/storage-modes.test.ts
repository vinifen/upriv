import { describe, expect, it } from "vitest";
import {
  STORAGE_MODES,
  storageModeCanSeal,
  storageModeCloseOnly,
  storageModeHasClosedCache,
  storageModeHasPortableArchive,
  storageModeIsPlaintext,
  storageModeSealOnly,
} from "..";

describe("STORAGE_MODES", () => {
  it("lists all product modes in UI order", () => {
    expect(STORAGE_MODES).toEqual([
      "encrypted_dir",
      "store_only",
      "upriv_only",
      "upriv_plain",
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
    ["upriv_only", true],
    ["upriv_plain", true],
    ["ram_only", false],
    ["plain", false],
    ["plain_only", false],
  ] as const)("mode %s → %s", (mode, expected) => {
    expect(storageModeHasClosedCache(mode)).toBe(expected);
  });
});

describe("storageModeCanSeal", () => {
  it.each([
    ["encrypted_dir", true],
    ["store_only", true],
    ["upriv_only", false],
    ["upriv_plain", false],
    ["ram_only", false],
    ["plain", false],
    ["plain_only", false],
  ] as const)("mode %s → %s", (mode, expected) => {
    expect(storageModeCanSeal(mode)).toBe(expected);
  });
});

describe("storageModeCloseOnly", () => {
  it.each([
    ["upriv_only", true],
    ["upriv_plain", true],
    ["encrypted_dir", false],
    ["store_only", false],
    ["ram_only", false],
  ] as const)("mode %s → %s", (mode, expected) => {
    expect(storageModeCloseOnly(mode)).toBe(expected);
  });
});

describe("storageModeHasPortableArchive", () => {
  it.each([
    ["upriv_only", false],
    ["upriv_plain", false],
    ["encrypted_dir", true],
    ["store_only", true],
    ["ram_only", true],
    ["plain", true],
    ["plain_only", true],
  ] as const)("mode %s → %s", (mode, expected) => {
    expect(storageModeHasPortableArchive(mode)).toBe(expected);
  });
});

describe("storageModeSealOnly", () => {
  it.each([
    ["plain", true],
    ["plain_only", true],
    ["ram_only", true],
    ["encrypted_dir", false],
    ["store_only", false],
    ["upriv_only", false],
    ["upriv_plain", false],
  ] as const)("mode %s → %s", (mode, expected) => {
    expect(storageModeSealOnly(mode)).toBe(expected);
  });
});

describe("storageModeIsPlaintext", () => {
  it.each([
    ["plain", true],
    ["plain_only", true],
    ["upriv_plain", true],
    ["encrypted_dir", false],
    ["store_only", false],
    ["upriv_only", false],
    ["ram_only", false],
  ] as const)("mode %s → %s", (mode, expected) => {
    expect(storageModeIsPlaintext(mode)).toBe(expected);
  });
});
