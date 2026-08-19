import { describe, expect, it } from "vitest";
import { applyVaultListHierarchySort } from "../hierarchy";
import type { VaultGroup } from "../types";
import { vaultListItemFixture } from "../../vault-list/tests/fixtures";
import { DEFAULT_VAULT_LIST_SORT } from "../../vault-list/sort";

function group(partial: Partial<VaultGroup> & Pick<VaultGroup, "id" | "groupedVaults">): VaultGroup {
  return {
    displayName: partial.id,
    order: 0,
    collapsed: false,
    groupedVaultSort: "order",
    groupedVaultSortDirection: "asc",
    ...partial,
  };
}

describe("applyVaultListHierarchySort", () => {
  it("claims vault ids first-group-wins", () => {
    const vaults = [
      vaultListItemFixture({ id: "notes", displayName: "Notes", order: 1 }),
      vaultListItemFixture({ id: "taxes", displayName: "Taxes", order: 2 }),
    ];
    const groups = [
      group({ id: "work", groupedVaults: ["notes"], order: 1 }),
      group({ id: "dup", groupedVaults: ["notes", "taxes"], order: 2 }),
    ];
    const rows = applyVaultListHierarchySort(vaults, groups, DEFAULT_VAULT_LIST_SORT);
    const work = rows.find((r) => r.kind === "group" && r.group.id === "work");
    const dup = rows.find((r) => r.kind === "group" && r.group.id === "dup");
    expect(work?.kind === "group" ? work.groupedVaults.map((v) => v.id) : []).toEqual(["notes"]);
    expect(dup?.kind === "group" ? dup.groupedVaults.map((v) => v.id) : []).toEqual(["taxes"]);
    expect(rows.some((r) => r.kind === "vault")).toBe(false);
  });

  it("omits hidden grouped vaults from children and reports hiddenVaultCount", () => {
    const vaults = [
      vaultListItemFixture({ id: "notes", displayName: "Notes", order: 1, hidden: false }),
      vaultListItemFixture({ id: "secret", displayName: "Secret", order: 2, hidden: true }),
    ];
    const groups = [group({ id: "work", groupedVaults: ["notes", "secret"], order: 1 })];
    const rows = applyVaultListHierarchySort(vaults, groups, DEFAULT_VAULT_LIST_SORT);
    const work = rows.find((r) => r.kind === "group" && r.group.id === "work");
    expect(work?.kind === "group" ? work.groupedVaults.map((v) => v.id) : []).toEqual(["notes"]);
    expect(work?.kind === "group" ? work.hiddenVaultCount : -1).toBe(1);
  });
});
