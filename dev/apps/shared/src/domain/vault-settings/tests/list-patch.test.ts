import { describe, expect, it } from "vitest";
import {
  applyVaultSettingsListPatch,
  remapVaultIdInGroups,
  vaultSettingsIdentityListPatch,
  vaultSettingsToListPatch,
} from "..";
import { vaultListItemFixture } from "../../vault-list/tests/fixtures";
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
      id: config.vault.id,
      displayName: "Work Docs",
      order: 5,
      note: "Tax stuff",
      hidden: true,
      passwordHint: "street name",
      storageMode: "encrypted_dir",
    });
  });

  it("carries the effective id after rename without extra flags", () => {
    const config = vaultSettingsFixture({
      vault: { id: "work-docs", display_name: "Work Docs" },
    });
    expect(vaultSettingsToListPatch(config).id).toBe("work-docs");
  });

  it("applies patch onto a list row including id remap", () => {
    const config = vaultSettingsFixture({
      vault: { id: "work-docs", display_name: "Work Docs", order: 2, note: "n", hidden: false },
    });
    const patch = vaultSettingsToListPatch(config);
    const row = vaultListItemFixture({
      id: "notes",
      displayName: "Notes",
      order: 1,
      note: "",
      hidden: false,
    });
    expect(applyVaultSettingsListPatch(row, patch)).toMatchObject({
      id: "work-docs",
      displayName: "Work Docs",
      order: 2,
      note: "n",
    });
  });

  it("remaps vault id inside groups", () => {
    const groups = [
      {
        id: "work",
        displayName: "Work",
        order: 1,
        collapsed: false,
        hidden: false,
        groupedVaults: ["notes", "other"],
        groupedVaultSort: "order" as const,
        groupedVaultSortDirection: "asc" as const,
      },
    ];
    expect(remapVaultIdInGroups(groups, "notes", "work-docs")[0]?.groupedVaults).toEqual([
      "work-docs",
      "other",
    ]);
  });

  it("omits empty password hint", () => {
    const config = vaultSettingsFixture({ vault: { password_hint: "   " } });
    expect(vaultSettingsToListPatch(config).passwordHint).toBeUndefined();
  });

  it("builds an identity-only patch from baseline + rename result", () => {
    const baseline = vaultSettingsFixture({
      vault: { id: "notes", display_name: "Notes", order: 3, note: "keep", hidden: true },
    });
    expect(vaultSettingsIdentityListPatch(baseline, "work-docs", "Work Docs")).toMatchObject({
      id: "work-docs",
      displayName: "Work Docs",
      order: 3,
      note: "keep",
      hidden: true,
    });
  });
});
