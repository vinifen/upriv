import { describe, expect, it } from "vitest";
import {
  createVaultChoosesKdf,
  DEFAULT_KDF_UNLOCK_PRESET,
  kdfParamsFromPreset,
  kdfPresetIsDowngrade,
  normalizeKdfUnlockPreset,
  parseKdfUnlockPreset,
} from "../kdf";

describe("kdfParamsFromPreset", () => {
  it("maps shipping presets (p = 1)", () => {
    expect(kdfParamsFromPreset("32mib")).toEqual({
      memoryKib: 32768,
      timeCost: 3,
      parallelism: 1,
    });
    expect(kdfParamsFromPreset("64mib")).toEqual({
      memoryKib: 65536,
      timeCost: 3,
      parallelism: 1,
    });
    expect(kdfParamsFromPreset("128mib")).toEqual({
      memoryKib: 131072,
      timeCost: 3,
      parallelism: 1,
    });
    expect(kdfParamsFromPreset("256mib")).toEqual({
      memoryKib: 262144,
      timeCost: 3,
      parallelism: 1,
    });
    expect(kdfParamsFromPreset("1gib")).toEqual({
      memoryKib: 1048576,
      timeCost: 1,
      parallelism: 1,
    });
    expect(kdfParamsFromPreset("2gib")).toEqual({
      memoryKib: 2097152,
      timeCost: 1,
      parallelism: 1,
    });
  });
});

describe("parseKdfUnlockPreset", () => {
  it("accepts shipping slugs and rejects typos", () => {
    expect(parseKdfUnlockPreset("64mib")).toBe("64mib");
    expect(parseKdfUnlockPreset("256MiB")).toBeNull();
    expect(parseKdfUnlockPreset("phone")).toBeNull();
  });
});

describe("normalizeKdfUnlockPreset", () => {
  it("defaults empty UI values to 256 MiB", () => {
    expect(normalizeKdfUnlockPreset(undefined)).toBe(DEFAULT_KDF_UNLOCK_PRESET);
    expect(normalizeKdfUnlockPreset("   ")).toBe(DEFAULT_KDF_UNLOCK_PRESET);
    expect(normalizeKdfUnlockPreset("phone")).toBe("256mib");
    expect(normalizeKdfUnlockPreset(" 64mib ")).toBe("64mib");
    expect(normalizeKdfUnlockPreset("64mib")).toBe("64mib");
    expect(normalizeKdfUnlockPreset("32mib")).toBe("32mib");
    expect(normalizeKdfUnlockPreset("128mib")).toBe("128mib");
  });
});

describe("createVaultChoosesKdf", () => {
  it("lets scratch and .7z import pick unlock RAM", () => {
    expect(createVaultChoosesKdf({ source: "scratch", importFileName: "" })).toBe(true);
    expect(createVaultChoosesKdf({ source: "import", importFileName: "Notes.7z" })).toBe(true);
    expect(createVaultChoosesKdf({ source: "import", importFileName: "" })).toBe(true);
  });

  it("skips the picker for .zip of store/ (header already has KDF)", () => {
    expect(createVaultChoosesKdf({ source: "import", importFileName: "Notes.upriv.zip" })).toBe(
      false,
    );
    expect(createVaultChoosesKdf({ source: "import", importFileName: "Notes.zip" })).toBe(false);
  });

  it("skips the picker for create-from-backup (frozen store/, stamp has no .zip)", () => {
    expect(
      createVaultChoosesKdf({
        source: "import",
        importKind: "backup",
        importFileName: "20260528T120000",
      }),
    ).toBe(false);
    expect(
      createVaultChoosesKdf({
        source: "import",
        importFileName: "20260528T120000",
        importFilePath: "vaults/cold-storage/backups/20260528T120000",
      }),
    ).toBe(false);
    expect(
      createVaultChoosesKdf({
        source: "import",
        importFileName: "Notes.7z",
        importFilePath: "vaults/notes/backups/Notes.7z",
      }),
    ).toBe(false);
  });
});

describe("kdfPresetIsDowngrade", () => {
  it("detects weaker presets", () => {
    expect(kdfPresetIsDowngrade("2gib", "256mib")).toBe(true);
    expect(kdfPresetIsDowngrade("256mib", "128mib")).toBe(true);
    expect(kdfPresetIsDowngrade("64mib", "32mib")).toBe(true);
    expect(kdfPresetIsDowngrade("256mib", "1gib")).toBe(false);
    expect(kdfPresetIsDowngrade("256mib", "256mib")).toBe(false);
  });
});
