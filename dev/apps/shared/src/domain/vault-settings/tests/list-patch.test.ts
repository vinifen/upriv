import { describe, expect, it } from "vitest";
import { vaultSettingsToListPatch } from "..";
import { vaultSettingsFixture } from "./fixtures";

describe("vaultSettingsToListPatch", () => {
  it("maps list fields from config", () => {
    const config = vaultSettingsFixture({
      storageMode: "encrypted_dir",
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
      storageMode: "encrypted_dir",
    });
  });

  it("omits empty password hint", () => {
    const config = vaultSettingsFixture({ vault: { password_hint: "   " } });
    expect(vaultSettingsToListPatch(config).passwordHint).toBeUndefined();
  });
});
