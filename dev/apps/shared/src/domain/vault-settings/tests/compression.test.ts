import { describe, expect, it } from "vitest";
import {
  compressionPresetFromSevenZip,
  normalizeSevenZipSection,
  sevenZipPatchFromCompressionPreset,
} from "..";

describe("sevenZipPatchFromCompressionPreset", () => {
  it.each([
    ["none", { archive_mode: "encrypt_only", compression_level: 0 }],
    ["low", { archive_mode: "compress_encrypt", compression_level: 1 }],
    ["medium", { archive_mode: "compress_encrypt", compression_level: 5 }],
    ["high", { archive_mode: "compress_encrypt", compression_level: 9 }],
  ] as const)("preset %s", (preset, expected) => {
    expect(sevenZipPatchFromCompressionPreset(preset)).toEqual(expected);
  });
});

describe("compressionPresetFromSevenZip", () => {
  it("maps presets round-trip", () => {
    for (const preset of ["none", "low", "medium", "high"] as const) {
      const patch = sevenZipPatchFromCompressionPreset(preset);
      expect(compressionPresetFromSevenZip(patch)).toBe(preset);
    }
  });

  it.each([
    [{ archive_mode: "encrypt_only" as const, compression_level: 5 }, "none"],
    [{ archive_mode: "compress_encrypt" as const, compression_level: 2 }, "low"],
    [{ archive_mode: "compress_encrypt" as const, compression_level: 5 }, "medium"],
    [{ archive_mode: "compress_encrypt" as const, compression_level: 9 }, "high"],
    [{ archive_mode: "compress_encrypt" as const, compression_level: 0 }, "low"],
  ] as const)("derives preset from TOML fields", (sevenZip, preset) => {
    expect(compressionPresetFromSevenZip(sevenZip)).toBe(preset);
  });
});

describe("normalizeSevenZipSection", () => {
  const base = {
    encrypt_file_names: true,
    solid: false,
    method: "lzma2" as const,
  };

  it("clears orphan compression_level on encrypt_only", () => {
    expect(
      normalizeSevenZipSection({
        ...base,
        archive_mode: "encrypt_only",
        compression_level: 5,
      }).compression_level,
    ).toBe(0);
  });

  it("clamps invalid compress_encrypt level to 1", () => {
    expect(
      normalizeSevenZipSection({
        ...base,
        archive_mode: "compress_encrypt",
        compression_level: 0,
      }).compression_level,
    ).toBe(1);
  });

  it("clamps levels above 9 and non-finite values", () => {
    expect(
      normalizeSevenZipSection({
        ...base,
        archive_mode: "compress_encrypt",
        compression_level: 42,
      }).compression_level,
    ).toBe(9);
    expect(
      normalizeSevenZipSection({
        ...base,
        archive_mode: "compress_encrypt",
        compression_level: Number.NaN,
      }).compression_level,
    ).toBe(5);
    expect(
      normalizeSevenZipSection({
        ...base,
        archive_mode: "compress_encrypt",
        compression_level: 4.6,
      }).compression_level,
    ).toBe(5);
  });

  it("leaves valid sections unchanged", () => {
    const section = {
      ...base,
      archive_mode: "compress_encrypt" as const,
      compression_level: 5,
    };
    expect(normalizeSevenZipSection(section)).toBe(section);
  });
});
