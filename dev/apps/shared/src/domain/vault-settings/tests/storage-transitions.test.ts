import { describe, expect, it } from "vitest";
import { patchStorageMode } from "..";
import { vaultSettingsFixture } from "./fixtures";

describe("patchStorageMode", () => {
  it("switches between the two remaining modes", () => {
    const base = vaultSettingsFixture({ storageMode: "encrypted_dir" });
    const next = patchStorageMode(base, "upriv_plain");
    expect(next.storage.mode).toBe("upriv_plain");
  });
});
