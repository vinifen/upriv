import { describe, expect, it } from "vitest";
import { parseVaultOpened, storageResetToastKey } from "..";

describe("parseVaultOpened", () => {
  it("reads the switches and a storage reset", () => {
    expect(parseVaultOpened({ switches: [], storageReset: "saved" })).toEqual({
      switches: [],
      storageReset: "saved",
      importKept: false,
    });
    expect(parseVaultOpened({ switches: [], storageReset: "unsaved" }).storageReset).toBe(
      "unsaved",
    );
  });

  it("reads an unlock that kept a cut-off import", () => {
    expect(parseVaultOpened({ switches: [], importKept: true }).importKept).toBe(true);
    expect(parseVaultOpened({ importKept: "yes" }).importKept).toBe(false);
  });

  it("reads an open with no reset, and a value it does not know as none", () => {
    expect(parseVaultOpened({ switches: [] })).toEqual({
      switches: [],
      storageReset: null,
      importKept: false,
    });
    expect(parseVaultOpened({ storageReset: "later" }).storageReset).toBeNull();
    expect(parseVaultOpened(null)).toEqual({
      switches: [],
      storageReset: null,
      importKept: false,
    });
  });
});

describe("storageResetToastKey", () => {
  it("says whether the fix reached the disk", () => {
    expect(storageResetToastKey("saved")).toBe("toast.vault_storage_reset.saved");
    expect(storageResetToastKey("unsaved")).toBe("toast.vault_storage_reset.unsaved");
  });
});
