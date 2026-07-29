import { describe, expect, it } from "vitest";
import { vaultSettingsToListPatch } from "..";
import { vaultSettingsFixture } from "./fixtures";

describe("vaultSettingsToListPatch", () => {
  it("maps list fields from config", () => {
    const config = vaultSettingsFixture({
      storageMode: "store_only",
      vault: {
        display_name: "Work Docs",
        order: 5,
        note: "Tax stuff",
        hidden: true,
        password_hint: "  street name  ",
      },
    });
    expect(vaultSettingsToListPatch(config)).toEqual({
      displayName: "Work Docs",
      order: 5,
      note: "Tax stuff",
      hidden: true,
      passwordHint: "street name",
      storageMode: "store_only",
      canSeal: true,
    });
  });

  it("omits empty password hint", () => {
    const config = vaultSettingsFixture({ vault: { password_hint: "   " } });
    expect(vaultSettingsToListPatch(config).passwordHint).toBeUndefined();
  });

  it("canSeal is false for seal-only storage modes", () => {
    expect(vaultSettingsToListPatch(vaultSettingsFixture({ storageMode: "plain" })).canSeal).toBe(
      false,
    );
  });
});
