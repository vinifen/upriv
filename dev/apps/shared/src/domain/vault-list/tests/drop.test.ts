import { describe, expect, it } from "vitest";
import { groupedVaultDragKey, listDropHighlight, resolveListDrop } from "..";

const allowGrouped = () => true;
const denyGrouped = () => false;

function resolve(
  sourceKey: string,
  targetKey: string | null,
  overrides?: Partial<{
    canReorderRoot: boolean;
    allowDragIntoGroup: boolean;
    canReorderGrouped: (groupId: string) => boolean;
  }>,
) {
  return resolveListDrop({
    sourceKey,
    targetKey,
    canReorderRoot: true,
    allowDragIntoGroup: true,
    canReorderGrouped: allowGrouped,
    ...overrides,
  });
}

describe("resolveListDrop", () => {
  it("reorders root rows when sort is by position", () => {
    expect(resolve("vault:a", "vault:b")).toEqual({ kind: "reorder-root" });
    expect(resolve("group:work", "vault:a")).toEqual({ kind: "reorder-root" });
  });

  it("blocks root reorder when sort is not by position", () => {
    expect(resolve("vault:a", "vault:b", { canReorderRoot: false })).toEqual({
      kind: "blocked-reorder-root",
    });
    expect(resolve("group:work", "group:home", { canReorderRoot: false })).toEqual({
      kind: "blocked-reorder-root",
    });
  });

  it("still assigns a vault onto a group when root reorder is blocked", () => {
    expect(resolve("vault:a", "group:work", { canReorderRoot: false })).toEqual({
      kind: "assign-to-group",
      vaultId: "a",
      targetGroupId: "work",
      beforeVaultId: null,
    });
    expect(
      resolve("vault:a", groupedVaultDragKey("work", "notes"), { canReorderRoot: false }),
    ).toEqual({
      kind: "assign-to-group",
      vaultId: "a",
      targetGroupId: "work",
      beforeVaultId: "notes",
    });
  });

  it("reorders inside a group when that group is sorted by position", () => {
    expect(resolve(groupedVaultDragKey("work", "a"), groupedVaultDragKey("work", "b"))).toEqual({
      kind: "reorder-grouped",
      groupId: "work",
      draggedVaultId: "a",
      targetVaultId: "b",
    });
  });

  it("blocks in-group reorder when the group is not sorted by position", () => {
    expect(
      resolve(groupedVaultDragKey("work", "a"), groupedVaultDragKey("work", "b"), {
        canReorderGrouped: denyGrouped,
      }),
    ).toEqual({ kind: "blocked-reorder-grouped" });
  });

  it("ungroups via the ungroup zone even when root reorder is blocked", () => {
    expect(
      resolve(groupedVaultDragKey("work", "a"), "list:ungroup:work", { canReorderRoot: false }),
    ).toEqual({ kind: "ungroup", vaultId: "a", beforeVaultId: null });
  });

  it("does not ungroup by dropping onto a root vault unless position sort is on", () => {
    expect(resolve(groupedVaultDragKey("work", "a"), "vault:b", { canReorderRoot: false })).toEqual(
      { kind: "blocked-reorder-root" },
    );
    expect(resolve(groupedVaultDragKey("work", "a"), "vault:b")).toEqual({
      kind: "ungroup",
      vaultId: "a",
      beforeVaultId: "b",
    });
  });

  it("is a no-op for missing or same-key targets", () => {
    expect(resolve("vault:a", null)).toEqual({ kind: "noop" });
    expect(resolve("vault:a", "vault:a")).toEqual({ kind: "noop" });
  });
});

describe("listDropHighlight", () => {
  it("is valid for a drop that applies, blocked when it does not, none for noop", () => {
    expect(listDropHighlight("reorder-root")).toBe("valid");
    expect(listDropHighlight("reorder-grouped")).toBe("valid");
    expect(listDropHighlight("assign-to-group")).toBe("valid");
    expect(listDropHighlight("ungroup")).toBe("valid");
    expect(listDropHighlight("blocked-reorder-root")).toBe("blocked");
    expect(listDropHighlight("blocked-reorder-grouped")).toBe("blocked");
    expect(listDropHighlight("noop")).toBe("none");
  });
});
