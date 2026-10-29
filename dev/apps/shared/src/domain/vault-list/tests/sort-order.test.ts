import { describe, expect, it } from "vitest";
import {
  applyVaultListSort,
  canReorderGroupedVaults,
  canReorderVaultList,
  DEFAULT_VAULT_LIST_SORT,
} from "..";
import { sortVaultsByOrder } from "..";
import { vaultListItemFixture } from "./fixtures";

describe("sortVaultsByOrder", () => {
  it("sorts by order then display name", () => {
    const sorted = sortVaultsByOrder([
      vaultListItemFixture({ id: "b", displayName: "Beta", order: 2 }),
      vaultListItemFixture({ id: "a", displayName: "Alpha", order: 1 }),
    ]);
    expect(sorted.map((v) => v.id)).toEqual(["a", "b"]);
  });

  it("orders names of one order as localeCompare does, case and accents aside", () => {
    const names = ["beta", "Álpha", "alpha", "Gamma", "ALPHA", "éclair", "Eclair", "zeta", "Beta"];
    const sorted = sortVaultsByOrder(
      names.map((displayName, index) =>
        vaultListItemFixture({ id: `v${index}`, displayName, order: 1 }),
      ),
    );
    const expected = [...names].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
    expect(sorted.map((v) => v.displayName)).toEqual(expected);
  });
});

describe("applyVaultListSort", () => {
  it("reverses when direction is desc", () => {
    const vaults = [
      vaultListItemFixture({ id: "a", order: 1 }),
      vaultListItemFixture({ id: "b", order: 2 }),
    ];
    const sorted = applyVaultListSort(vaults, { mode: "order", direction: "desc" });
    expect(sorted.map((v) => v.id)).toEqual(["b", "a"]);
  });

  it("uses default sort config", () => {
    expect(DEFAULT_VAULT_LIST_SORT).toEqual({ mode: "order", direction: "asc" });
    expect(canReorderVaultList(DEFAULT_VAULT_LIST_SORT)).toBe(true);
    expect(canReorderVaultList({ mode: "order", direction: "desc" })).toBe(true);
    expect(canReorderVaultList({ mode: "name", direction: "asc" })).toBe(false);
    expect(canReorderGroupedVaults({ mode: "order", direction: "desc" })).toBe(true);
    expect(canReorderGroupedVaults({ mode: "name", direction: "asc" })).toBe(false);
  });
});
