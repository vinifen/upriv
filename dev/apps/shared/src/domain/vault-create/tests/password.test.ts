import { describe, expect, it } from "vitest";
import { createVaultSetsPassword } from "../password";
import { createVaultDraftFixture } from "./fixtures";

describe("createVaultSetsPassword", () => {
  it("asks for a new password from scratch and for a files import", () => {
    expect(createVaultSetsPassword(createVaultDraftFixture())).toBe(true);
    const files = createVaultDraftFixture([], {
      source: "import",
      importShape: "directory",
      importFileName: "Photos",
      importFilePath: "/home/me/Photos",
    });
    expect(createVaultSetsPassword(files)).toBe(true);
  });

  it("keeps the password a backup or a store zip already has", () => {
    const backup = createVaultDraftFixture([], { source: "import", importKind: "backup" });
    expect(createVaultSetsPassword(backup)).toBe(false);
    const storeZip = createVaultDraftFixture([], {
      source: "import",
      importFileName: "Notes-upriv.zip",
      importFilePath: "/home/me/Notes-upriv.zip",
      zipLayout: "store",
    });
    expect(createVaultSetsPassword(storeZip)).toBe(false);
  });

  it("leaves a .7z to its own password", () => {
    const sevenZip = createVaultDraftFixture([], {
      source: "import",
      importFileName: "Notes-sevenzip.7z",
      importFilePath: "/home/me/Notes-sevenzip.7z",
    });
    expect(createVaultSetsPassword(sevenZip)).toBe(false);
  });
});
