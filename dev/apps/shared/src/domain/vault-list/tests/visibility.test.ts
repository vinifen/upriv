import { describe, expect, it } from "vitest";
import { filterVisibleVaults } from "../visibility";
import { vaultListItemFixture } from "./fixtures";

describe("filterVisibleVaults", () => {
  const vaults = [
    vaultListItemFixture({ id: "a", hidden: false }),
    vaultListItemFixture({ id: "b", hidden: true }),
  ];

  it("omits hidden vaults by default", () => {
    expect(filterVisibleVaults(vaults, false).map((v) => v.id)).toEqual(["a"]);
  });

  it("keeps hidden vaults when show-hidden is on", () => {
    expect(filterVisibleVaults(vaults, true).map((v) => v.id)).toEqual(["a", "b"]);
  });
});
