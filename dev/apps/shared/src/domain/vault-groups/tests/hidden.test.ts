import { describe, expect, it } from "vitest";
import {
  groupsForAssignmentPicker,
  isHiddenGroup,
  isVaultInHiddenGroup,
  vaultIdsInHiddenGroups,
  vaultIdsUnhiddenByGroups,
} from "../hidden";
import type { VaultGroup } from "../types";

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

describe("hidden groups", () => {
  const groups = [
    group({ id: "work", groupedVaults: ["notes"], hidden: true }),
    group({ id: "home", groupedVaults: ["taxes"] }),
  ];

  it("lists members of hidden groups", () => {
    expect(vaultIdsInHiddenGroups(groups)).toEqual(["notes"]);
  });

  it("detects a vault inside a hidden group", () => {
    expect(isVaultInHiddenGroup(groups, "notes")).toBe(true);
    expect(isVaultInHiddenGroup(groups, "taxes")).toBe(false);
  });

  it("detects a hidden group by id", () => {
    expect(isHiddenGroup(groups, "work")).toBe(true);
    expect(isHiddenGroup(groups, "home")).toBe(false);
    expect(isHiddenGroup(groups, "")).toBe(false);
  });

  it("hides hidden groups from assignment unless includeHidden or selected", () => {
    expect(groupsForAssignmentPicker(groups).map((item) => item.id)).toEqual(["home"]);
    expect(
      groupsForAssignmentPicker(groups, { includeHidden: true }).map((item) => item.id),
    ).toEqual(["work", "home"]);
    expect(
      groupsForAssignmentPicker(groups, { selectedGroupId: "work" }).map((item) => item.id),
    ).toEqual(["work", "home"]);
  });

  it("unhides members when a group flips from hidden to visible, not on delete", () => {
    const previous = [group({ id: "work", groupedVaults: ["notes", "taxes"], hidden: true })];
    const visible = [group({ id: "work", groupedVaults: ["notes", "taxes"], hidden: false })];
    expect(vaultIdsUnhiddenByGroups(previous, visible)).toEqual(["notes", "taxes"]);
    expect(vaultIdsUnhiddenByGroups(previous, [])).toEqual([]);
    expect(vaultIdsUnhiddenByGroups(visible, visible)).toEqual([]);
  });
});
