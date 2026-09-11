import { describe, expect, it } from "vitest";
import { buildGroupedVaultPickerItems, groupAssignmentClearOption } from "../picker";
import type { VaultGroup } from "../types";
import { vaultListItemFixture } from "../../vault-list/tests/fixtures";

function group(
  partial: Partial<VaultGroup> & Pick<VaultGroup, "id" | "groupedVaults">,
): VaultGroup {
  return {
    displayName: partial.id,
    order: 0,
    collapsed: false,
    hidden: false,
    groupedVaultSort: "order",
    groupedVaultSortDirection: "asc",
    ...partial,
  };
}

describe("buildGroupedVaultPickerItems", () => {
  const vaults = [
    vaultListItemFixture({ id: "a", displayName: "Alpha" }),
    vaultListItemFixture({ id: "b", displayName: "Beta" }),
    vaultListItemFixture({ id: "c", displayName: "Gamma" }),
  ];

  it("filters by query and keeps name order", () => {
    const items = buildGroupedVaultPickerItems({
      vaults,
      groups: [group({ id: "g1", groupedVaults: ["c"] })],
      query: "alp",
    });
    expect(items.map((i) => i.vault.id)).toEqual(["a"]);
  });

  it("includes vaults already in another group and labels them", () => {
    const items = buildGroupedVaultPickerItems({
      vaults,
      groups: [group({ id: "g1", groupedVaults: ["a", "c"] })],
    });
    expect(items.map((i) => i.vault.id)).toEqual(["a", "b", "c"]);
    expect(items.find((i) => i.vault.id === "a")?.otherGroup?.id).toBe("g1");
    expect(items.find((i) => i.vault.id === "b")?.otherGroup).toBeNull();
    expect(items.find((i) => i.vault.id === "c")?.otherGroup?.id).toBe("g1");
  });

  it("excludes the edited group from other-group labeling", () => {
    const items = buildGroupedVaultPickerItems({
      vaults,
      groups: [group({ id: "g1", groupedVaults: ["b"] })],
      excludeGroupId: "g1",
    });
    expect(items.find((i) => i.vault.id === "b")?.otherGroup).toBeNull();
  });

  it("omits hidden vaults unless includeHidden", () => {
    const withHidden = [
      ...vaults,
      vaultListItemFixture({ id: "secret", displayName: "Secret", hidden: true }),
    ];
    expect(
      buildGroupedVaultPickerItems({ vaults: withHidden, groups: [] }).map((i) => i.vault.id),
    ).toEqual(["a", "b", "c"]);
    expect(
      buildGroupedVaultPickerItems({
        vaults: withHidden,
        groups: [],
        includeHidden: true,
      }).map((i) => i.vault.id),
    ).toEqual(["a", "b", "c", "secret"]);
  });
});

describe("groupAssignmentClearOption", () => {
  const t = (key: string) => key;

  it("uses remove + danger when a group is already selected", () => {
    expect(groupAssignmentClearOption("work", t)).toEqual({
      value: "",
      label: "vault.group.assignment.remove",
      tone: "danger",
    });
  });

  it("uses none + muted when the vault is ungrouped", () => {
    expect(groupAssignmentClearOption("", t)).toEqual({
      value: "",
      label: "vault.group.assignment.none",
      tone: "muted",
    });
  });
});
