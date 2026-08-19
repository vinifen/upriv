import { describe, expect, it } from "vitest";
import { listVaultsBlockingBulkExport, listVaultsReadyForBulkExport, vaultBlocksBulkExport } from "..";
import { vaultListItemFixture } from "./fixtures";

describe("vaultBlocksBulkExport", () => {
  it("blocks close-only vaults (no portable .7z)", () => {
    expect(
      vaultBlocksBulkExport(
        vaultListItemFixture({ storageMode: "upriv_plain", session: null, persistence: "closed" }),
      ),
    ).toBe(true);
  });

  it("blocks open closed-cache vaults", () => {
    expect(
      vaultBlocksBulkExport(
        vaultListItemFixture({
          storageMode: "encrypted_dir",
          session: "open",
          persistence: "closed",
        }),
      ),
    ).toBe(true);
  });

  it("allows sealed portable archives", () => {
    expect(
      vaultBlocksBulkExport(
        vaultListItemFixture({ storageMode: "store_only", session: null, persistence: "sealed" }),
      ),
    ).toBe(false);
  });
});

describe("listVaultsBlockingBulkExport", () => {
  it("does not treat Upriv-only as an open-session blocker", () => {
    const uprivOnly = vaultListItemFixture({
      id: "u",
      storageMode: "upriv_only",
      session: null,
      persistence: "closed",
    });
    const open = vaultListItemFixture({
      id: "o",
      storageMode: "encrypted_dir",
      session: "open",
      persistence: "closed",
    });
    expect(listVaultsBlockingBulkExport([uprivOnly, open]).map((row) => row.id)).toEqual(["o"]);
    expect(listVaultsReadyForBulkExport([uprivOnly, open])).toEqual([]);
  });
});
