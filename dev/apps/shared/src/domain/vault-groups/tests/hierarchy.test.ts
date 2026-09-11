import { describe, expect, it } from "vitest";
import { applyVaultListHierarchySort, filterVaultListRowsBySearch } from "../hierarchy";
import type { VaultGroup } from "../types";
import { vaultListItemFixture } from "../../vault-list/tests/fixtures";
import { DEFAULT_VAULT_LIST_SORT } from "../../vault-list/sort";

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

  it("omits hidden groups while still claiming their vaults", () => {
    const vaults = [vaultListItemFixture({ id: "notes", displayName: "Notes", order: 1 })];
    const groups = [group({ id: "secrets", groupedVaults: ["notes"], order: 1, hidden: true })];
    const rows = applyVaultListHierarchySort(vaults, groups, DEFAULT_VAULT_LIST_SORT);
    expect(rows).toEqual([]);
  });

  it("shows hidden groups when showHiddenVaults is on", () => {
    const vaults = [
      vaultListItemFixture({ id: "notes", displayName: "Notes", order: 1, hidden: true }),
    ];
    const groups = [group({ id: "secrets", groupedVaults: ["notes"], order: 1, hidden: true })];
    const rows = applyVaultListHierarchySort(vaults, groups, DEFAULT_VAULT_LIST_SORT, {
      showHiddenVaults: true,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind === "group" ? rows[0].group.id : "").toBe("secrets");
    expect(rows[0]?.kind === "group" ? rows[0].groupedVaults.map((v) => v.id) : []).toEqual([
      "notes",
    ]);
  });
});

describe("filterVaultListRowsBySearch", () => {
  const vaults = [
    vaultListItemFixture({ id: "notes", displayName: "Notes", order: 1 }),
    vaultListItemFixture({ id: "taxes", displayName: "Taxes", order: 2 }),
    vaultListItemFixture({ id: "inbox", displayName: "Inbox", order: 3 }),
  ];
  const groups = [
    group({
      id: "work",
      displayName: "Work",
      groupedVaults: ["notes", "taxes"],
      order: 10,
    }),
  ];
  const rows = applyVaultListHierarchySort(vaults, groups, DEFAULT_VAULT_LIST_SORT);

  it("is a no-op for empty and whitespace queries", () => {
    expect(filterVaultListRowsBySearch(rows, "")).toBe(rows);
    expect(filterVaultListRowsBySearch(rows, "   ")).toBe(rows);
  });

  it("matches ungrouped vault names", () => {
    const filtered = filterVaultListRowsBySearch(rows, "inb");
    expect(filtered.map((row) => (row.kind === "vault" ? row.vault.id : row.group.id))).toEqual([
      "inbox",
    ]);
  });

  it("matches a group name and keeps all of its visible vaults", () => {
    const filtered = filterVaultListRowsBySearch(rows, "work");
    expect(filtered).toHaveLength(1);
    const row = filtered[0];
    expect(row?.kind).toBe("group");
    if (row?.kind !== "group") return;
    expect(row.group.collapsed).toBe(false);
    expect(row.groupedVaults.map((vault) => vault.id)).toEqual(["notes", "taxes"]);
  });

  it("matches vaults inside a group without forcing the group open", () => {
    const collapsed = applyVaultListHierarchySort(
      vaults,
      groups.map((item) => ({ ...item, collapsed: true })),
      DEFAULT_VAULT_LIST_SORT,
    );
    const filtered = filterVaultListRowsBySearch(collapsed, "tax");
    expect(filtered).toHaveLength(1);
    const row = filtered[0];
    expect(row?.kind).toBe("group");
    if (row?.kind !== "group") return;
    expect(row.group.collapsed).toBe(true);
    expect(row.groupedVaults.map((vault) => vault.id)).toEqual(["taxes"]);
  });
});
