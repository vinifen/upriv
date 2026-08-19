import { describe, expect, it } from "vitest";
import {
  assignVaultToGroup,
  insertUngroupedVaultAtRoot,
  removeVaultFromGroups,
  reorderGroupedVaults,
  reorderRootRows,
} from "../order";
import type { VaultListRootRow } from "../hierarchy";
import type { VaultGroup } from "../types";
import { vaultListItemFixture } from "../../vault-list/tests/fixtures";

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

describe("assignVaultToGroup", () => {
  it("moves an ungrouped vault onto the target and keeps exclusivity", () => {
    const groups = [
      group({ id: "work", groupedVaults: ["notes"], order: 1 }),
      group({ id: "personal", groupedVaults: ["diary"], order: 2 }),
    ];
    const next = assignVaultToGroup(groups, "taxes", "work");
    expect(next.find((g) => g.id === "work")?.groupedVaults).toEqual(["notes", "taxes"]);
    expect(next.find((g) => g.id === "personal")?.groupedVaults).toEqual(["diary"]);
  });

  it("moves a vault from another group and can insert before a member", () => {
    const groups = [
      group({ id: "work", groupedVaults: ["notes", "taxes"], order: 1 }),
      group({ id: "personal", groupedVaults: ["diary"], order: 2 }),
    ];
    const next = assignVaultToGroup(groups, "diary", "work", "taxes");
    expect(next.find((g) => g.id === "work")?.groupedVaults).toEqual(["notes", "diary", "taxes"]);
    expect(next.find((g) => g.id === "personal")?.groupedVaults).toEqual([]);
  });
});

describe("removeVaultFromGroups", () => {
  it("ungroups a vault and leaves other groups unchanged", () => {
    const groups = [
      group({ id: "work", groupedVaults: ["notes", "taxes"], order: 1 }),
      group({ id: "personal", groupedVaults: ["diary"], order: 2 }),
    ];
    const next = removeVaultFromGroups(groups, "notes");
    expect(next.find((g) => g.id === "work")?.groupedVaults).toEqual(["taxes"]);
    expect(next.find((g) => g.id === "personal")?.groupedVaults).toEqual(["diary"]);
  });
});

function vault(partial: Parameters<typeof vaultListItemFixture>[0]) {
  return vaultListItemFixture(partial);
}

function rootVault(id: string, order: number): VaultListRootRow {
  return { kind: "vault", vault: vault({ id, order }) };
}

function rootGroup(
  id: string,
  order: number,
  groupedVaults: VaultListItem[] = [],
): VaultListRootRow {
  return {
    kind: "group",
    group: group({ id, order, groupedVaults: groupedVaults.map((v) => v.id) }),
    groupedVaults,
    hiddenVaultCount: 0,
  };
}

describe("reorderRootRows", () => {
  it("moves a vault past a group and reassigns order 1…n", () => {
    const rows: VaultListRootRow[] = [
      rootVault("a", 1),
      rootGroup("work", 2),
      rootVault("b", 3),
    ];
    const next = reorderRootRows(rows, "vault:a", "vault:b");
    expect(next.map((row) => (row.kind === "vault" ? row.vault.id : row.group.id))).toEqual([
      "work",
      "b",
      "a",
    ]);
    expect(next.map((row) => (row.kind === "vault" ? row.vault.order : row.group.order))).toEqual([
      1, 2, 3,
    ]);
  });

  it("is a no-op when keys match or are missing", () => {
    const rows: VaultListRootRow[] = [rootVault("a", 1), rootVault("b", 2)];
    expect(reorderRootRows(rows, "vault:a", "vault:a")).toBe(rows);
    expect(reorderRootRows(rows, "vault:missing", "vault:b")).toBe(rows);
  });
});

describe("reorderGroupedVaults", () => {
  it("reorders members inside a group", () => {
    const g = group({ id: "work", groupedVaults: ["notes", "taxes", "diary"] });
    const next = reorderGroupedVaults(g, "diary", "notes");
    expect(next.groupedVaults).toEqual(["diary", "notes", "taxes"]);
  });
});

describe("insertUngroupedVaultAtRoot", () => {
  it("inserts before a target vault and reassigns root orders", () => {
    const rows: VaultListRootRow[] = [rootGroup("work", 1), rootVault("b", 2)];
    const next = insertUngroupedVaultAtRoot(rows, vault({ id: "a", order: 99 }), "b");
    expect(next.map((row) => (row.kind === "vault" ? row.vault.id : row.group.id))).toEqual([
      "work",
      "a",
      "b",
    ]);
    expect(next.map((row) => (row.kind === "vault" ? row.vault.order : row.group.order))).toEqual([
      1, 2, 3,
    ]);
  });

  it("appends when beforeVaultId is absent", () => {
    const rows: VaultListRootRow[] = [rootGroup("work", 1)];
    const next = insertUngroupedVaultAtRoot(rows, vault({ id: "a" }));
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({ kind: "vault", vault: { id: "a", order: 2 } });
  });
});
