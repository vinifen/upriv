import { describe, expect, it } from "vitest";
import { parseVaultRebuildResult, vaultRebuiltToast, type VaultRebuildResult } from "..";

const tr = (key: string, params?: Record<string, string>) =>
  params ? `${key}(${Object.values(params).join(",")})` : key;

function result(patch: Partial<VaultRebuildResult> = {}): VaultRebuildResult {
  return {
    headerRestored: false,
    treeRebuilt: true,
    files: 3,
    setAside: 0,
    copy: "20261117120000-notes.zip",
    copySkipped: null,
    storageReset: false,
    ...patch,
  };
}

describe("parseVaultRebuildResult", () => {
  it("reads every field and leaves an unknown skip reason out", () => {
    expect(
      parseVaultRebuildResult({
        headerRestored: true,
        treeRebuilt: false,
        files: 0,
        setAside: 2,
        copy: null,
        copySkipped: "no_room",
        storageReset: true,
      }),
    ).toEqual({
      headerRestored: true,
      treeRebuilt: false,
      files: 0,
      setAside: 2,
      copy: null,
      copySkipped: "no_room",
      storageReset: true,
    });
    expect(parseVaultRebuildResult({ copySkipped: "later" }).copySkipped).toBeNull();
    expect(parseVaultRebuildResult({}).storageReset).toBe(false);
  });
});

describe("vaultRebuiltToast", () => {
  it("names the files placed, and those set aside", () => {
    expect(vaultRebuiltToast(result(), "Notes", tr)).toBe("toast.vault_rebuilt(Notes,3)");
    expect(vaultRebuiltToast(result({ setAside: 2 }), "Notes", tr)).toBe(
      "toast.vault_rebuilt_set_aside(Notes,3,2)",
    );
  });

  it("says the header came back when the list opened with it", () => {
    expect(
      vaultRebuiltToast(result({ headerRestored: true, treeRebuilt: false }), "Notes", tr),
    ).toBe("toast.vault_header_restored(Notes)");
  });

  it("adds why the rebuild ran without a copy from before", () => {
    expect(vaultRebuiltToast(result({ copy: null, copySkipped: "no_room" }), "Notes", tr)).toBe(
      "toast.vault_rebuilt(Notes,3) toast.vault_rebuild_copy_skipped.no_room",
    );
    expect(vaultRebuiltToast(result({ copy: null, copySkipped: "failed" }), "Notes", tr)).toBe(
      "toast.vault_rebuilt(Notes,3) toast.vault_rebuild_copy_skipped.failed",
    );
  });

  it("ends with plain text turned off when the rebuild turned it off", () => {
    expect(
      vaultRebuiltToast(
        result({ copy: null, copySkipped: "no_room", storageReset: true }),
        "Notes",
        tr,
      ),
    ).toBe(
      "toast.vault_rebuilt(Notes,3) toast.vault_rebuild_copy_skipped.no_room toast.vault_rebuild_storage_reset",
    );
  });
});
