import { describe, expect, it } from "vitest";
import { buildCreateVaultResult } from "../../vault-create";
import { createVaultDraftFixture } from "../../vault-create/tests/fixtures";
import type { VaultGroup } from "../../vault-groups/types";
import {
  applyPendingCreateGroupEffect,
  buildCreatingVaultListItem,
  buildPendingCreateGroupEffect,
  mergePendingCreatingGroups,
  mergePendingCreatingVaults,
  nextVaultGroupOrder,
  pendingCreateGroupId,
  rollbackPendingCreateGroupEffect,
} from "../pendingCreate";
import { vaultListItemFixture } from "./fixtures";

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

describe("buildCreatingVaultListItem", () => {
  it("maps create result fields and keeps the row visible", () => {
    const result = buildCreateVaultResult(
      createVaultDraftFixture([], {
        displayName: "Travel",
        note: "trips",
        passwordHint: "hint",
        hidden: true,
        kdf: { unlock_preset: "128mib" },
      }),
      [],
    );
    expect(buildCreatingVaultListItem(result)).toEqual({
      id: "travel",
      displayName: "Travel",
      session: null,
      storageMode: "encrypted_dir",
      order: result.order,
      passwordHint: "hint",
      lastAccessedWhen: "",
      lastAccessedAt: "",
      note: "trips",
      unlockPreset: "128mib",
    });
  });
});

describe("mergePendingCreatingVaults", () => {
  it("appends placeholders that the live list does not have yet", () => {
    const listed = [vaultListItemFixture({ id: "notes" })];
    const pending = [vaultListItemFixture({ id: "travel" }), vaultListItemFixture({ id: "notes" })];
    expect(mergePendingCreatingVaults(listed, pending).map((row) => row.id)).toEqual([
      "notes",
      "travel",
    ]);
  });
});

describe("pending create group optimism", () => {
  it("builds a create effect with core-like order and membership", () => {
    const existing = [group({ id: "work", order: 2, groupedVaults: ["a"] })];
    const effect = buildPendingCreateGroupEffect(
      { kind: "create", displayName: "Travel" },
      "travel",
      existing,
    );
    expect(effect).toEqual({
      kind: "create",
      group: expect.objectContaining({
        id: "travel",
        displayName: "Travel",
        order: nextVaultGroupOrder(existing),
        groupedVaults: ["travel"],
      }),
    });
  });

  it("applies create and existing effects immediately", () => {
    const base = [group({ id: "work", order: 1, groupedVaults: ["notes"] })];
    const created = buildPendingCreateGroupEffect(
      { kind: "create", displayName: "Travel" },
      "travel",
      base,
    )!;
    expect(applyPendingCreateGroupEffect(base, created).map((g) => g.id)).toEqual([
      "work",
      "travel",
    ]);

    const existing = buildPendingCreateGroupEffect(
      { kind: "existing", groupId: "work" },
      "taxes",
      base,
    )!;
    expect(
      applyPendingCreateGroupEffect(base, existing).find((g) => g.id === "work")?.groupedVaults,
    ).toEqual(["notes", "taxes"]);
  });

  it("rolls back create by removing the optimistic group", () => {
    const effect = buildPendingCreateGroupEffect(
      { kind: "create", displayName: "Travel" },
      "travel",
      [],
    )!;
    const withGroup = applyPendingCreateGroupEffect([], effect);
    expect(rollbackPendingCreateGroupEffect(withGroup, effect)).toEqual([]);
  });

  it("merges pending create groups across list refresh", () => {
    const effect = buildPendingCreateGroupEffect(
      { kind: "create", displayName: "Travel" },
      "travel",
      [],
    )!;
    const listed = [group({ id: "work", order: 1, groupedVaults: ["notes"] })];
    expect(mergePendingCreatingGroups(listed, [effect]).map((g) => g.id)).toEqual([
      "work",
      "travel",
    ]);
  });

  it("reuses the optimistic group id for the create RPC", () => {
    const effect = buildPendingCreateGroupEffect(
      { kind: "create", displayName: "Travel" },
      "travel",
      [],
    )!;
    expect(
      pendingCreateGroupId(effect, { kind: "create", displayName: "Travel" }, ["travel"]),
    ).toBe("travel");
  });
});
