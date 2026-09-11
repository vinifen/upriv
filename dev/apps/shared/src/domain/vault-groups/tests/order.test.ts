import { describe, expect, it } from "vitest";
import {
  assignVaultToGroup,
  hiddenUngroupedRootVaults,
  hiddenOmittedRootGroups,
  insertUngroupedVaultAtRoot,
  removeVaultFromGroups,
  reorderGroupedVaults,
  reorderRootRows,
} from "../order";
import type { VaultListRootRow } from "../hierarchy";
import type { VaultGroup } from "../types";
import type { VaultListItem } from "../../vault-list/types";
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

  it("can insert after the drop target (order+desc display)", () => {
    const groups = [group({ id: "work", groupedVaults: ["notes", "taxes"], order: 1 })];
    const next = assignVaultToGroup(groups, "diary", "work", "notes", { insertAfter: true });
    expect(next.find((g) => g.id === "work")?.groupedVaults).toEqual(["notes", "diary", "taxes"]);
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
  it("swaps the dragged vault with the drop target and reassigns order 1…n", () => {
    const rows: VaultListRootRow[] = [rootVault("a", 1), rootGroup("work", 2), rootVault("b", 3)];
    const next = reorderRootRows(rows, "vault:a", "vault:b");
    expect(next.map((row) => (row.kind === "vault" ? row.vault.id : row.group.id))).toEqual([
      "b",
      "work",
      "a",
    ]);
    expect(next.map((row) => (row.kind === "vault" ? row.vault.order : row.group.order))).toEqual([
      1, 2, 3,
    ]);
  });

  it("leaves the middle row in place when swapping the ends", () => {
    const rows: VaultListRootRow[] = [rootVault("a", 1), rootVault("b", 2), rootVault("c", 3)];
    const next = reorderRootRows(rows, "vault:a", "vault:c");
    expect(next.map((row) => (row.kind === "vault" ? row.vault.id : row.group.id))).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("is a no-op when keys match or are missing", () => {
    const rows: VaultListRootRow[] = [rootVault("a", 1), rootVault("b", 2)];
    expect(reorderRootRows(rows, "vault:a", "vault:a")).toBe(rows);
    expect(reorderRootRows(rows, "vault:missing", "vault:b")).toBe(rows);
  });

  it("assigns high-to-low order when the visible list is descending", () => {
    const rows: VaultListRootRow[] = [rootVault("c", 3), rootVault("b", 2), rootVault("a", 1)];
    const next = reorderRootRows(rows, "vault:c", "vault:b", "desc");
    expect(next.map((row) => (row.kind === "vault" ? row.vault.id : row.group.id))).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(next.map((row) => (row.kind === "vault" ? row.vault.order : row.group.order))).toEqual([
      3, 2, 1,
    ]);
  });

  it("appends hidden ungrouped vaults after the visible sequence", () => {
    const rows: VaultListRootRow[] = [rootVault("a", 1), rootVault("b", 2)];
    const hidden = [vault({ id: "h", order: 2, hidden: true, displayName: "Hidden" })];
    const next = reorderRootRows(rows, "vault:a", "vault:b", "asc", hidden);
    expect(next.map((row) => (row.kind === "vault" ? row.vault.id : row.group.id))).toEqual([
      "b",
      "a",
      "h",
    ]);
    expect(next.map((row) => (row.kind === "vault" ? row.vault.order : row.group.order))).toEqual([
      1, 2, 3,
    ]);
  });

  it("keeps hidden vaults at the visual bottom when the list is descending", () => {
    const rows: VaultListRootRow[] = [rootVault("b", 2), rootVault("a", 1)];
    const hidden = [vault({ id: "h", order: 9, hidden: true, displayName: "Hidden" })];
    const next = reorderRootRows(rows, "vault:b", "vault:a", "desc", hidden);
    expect(next.map((row) => (row.kind === "vault" ? row.vault.id : row.group.id))).toEqual([
      "a",
      "b",
      "h",
    ]);
    expect(next.map((row) => (row.kind === "vault" ? row.vault.order : row.group.order))).toEqual([
      3, 2, 1,
    ]);
  });

  it("appends omitted hidden groups after the visible sequence", () => {
    const rows: VaultListRootRow[] = [rootVault("a", 1), rootVault("b", 3)];
    const hiddenGroups = [group({ id: "secrets", groupedVaults: ["n"], order: 2, hidden: true })];
    const next = reorderRootRows(rows, "vault:a", "vault:b", "asc", [], hiddenGroups);
    expect(next.map((row) => (row.kind === "vault" ? row.vault.id : row.group.id))).toEqual([
      "b",
      "a",
      "secrets",
    ]);
    expect(next.map((row) => (row.kind === "vault" ? row.vault.order : row.group.order))).toEqual([
      1, 2, 3,
    ]);
  });
});

describe("reorderGroupedVaults", () => {
  it("swaps two members and leaves the others in place", () => {
    const g = group({ id: "work", groupedVaults: ["notes", "taxes", "diary"] });
    const next = reorderGroupedVaults(g, "diary", "notes");
    expect(next.groupedVaults).toEqual(["diary", "taxes", "notes"]);
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

  it("assigns descending orders so the inserted row stays in place", () => {
    const rows: VaultListRootRow[] = [rootVault("c", 2), rootVault("b", 1)];
    const next = insertUngroupedVaultAtRoot(rows, vault({ id: "a", order: 99 }), "b", "desc");
    expect(next.map((row) => (row.kind === "vault" ? row.vault.id : row.group.id))).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(next.map((row) => (row.kind === "vault" ? row.vault.order : row.group.order))).toEqual([
      3, 2, 1,
    ]);
  });

  it("keeps hidden ungrouped vaults after the inserted visible row", () => {
    const rows: VaultListRootRow[] = [rootVault("b", 1)];
    const hidden = [vault({ id: "h", order: 5, hidden: true, displayName: "Hidden" })];
    const next = insertUngroupedVaultAtRoot(
      rows,
      vault({ id: "a", order: 99 }),
      null,
      "asc",
      hidden,
    );
    expect(next.map((row) => (row.kind === "vault" ? row.vault.id : row.group.id))).toEqual([
      "b",
      "a",
      "h",
    ]);
    expect(next.map((row) => (row.kind === "vault" ? row.vault.order : row.group.order))).toEqual([
      1, 2, 3,
    ]);
  });
});

describe("hiddenUngroupedRootVaults", () => {
  it("returns hidden ungrouped vaults that are missing from the visible rows", () => {
    const vaults = [
      vault({ id: "a", order: 1 }),
      vault({ id: "h", order: 4, hidden: true, displayName: "Hidden" }),
      vault({ id: "g-hidden", order: 8, hidden: true, displayName: "In group" }),
    ];
    const groups = [group({ id: "work", groupedVaults: ["g-hidden"] })];
    const visible: VaultListRootRow[] = [rootVault("a", 1), rootGroup("work", 2)];
    expect(hiddenUngroupedRootVaults(vaults, groups, visible).map((item) => item.id)).toEqual([
      "h",
    ]);
  });
});

describe("hiddenOmittedRootGroups", () => {
  it("returns hidden groups missing from the visible rows, sorted by order", () => {
    const visible: VaultListRootRow[] = [rootVault("a", 1), rootGroup("work", 3)];
    const groups = [
      group({ id: "work", groupedVaults: ["a"], order: 3 }),
      group({ id: "secrets", groupedVaults: ["n"], order: 2, hidden: true }),
      group({ id: "archive", groupedVaults: [], order: 4, hidden: true }),
    ];
    expect(hiddenOmittedRootGroups(groups, visible).map((item) => item.id)).toEqual([
      "secrets",
      "archive",
    ]);
  });
});
