import { describe, expect, it } from "vitest";
import { createDraftFromBackup } from "../createDraftFromBackup";
import {
  createDraftForImportSource,
  createDraftForScratchSource,
  createDraftFromImportPackage,
  createVaultImportNeedsRename,
} from "../createDraftFromImportPackage";

describe("createDraftFromBackup", () => {
  it("seeds import source with a backup-named display name", () => {
    const draft = createDraftFromBackup("20260528T120000", "notes", [1]);
    expect(draft.source).toBe("import");
    expect(draft.importFilePath).toBe("vaults/notes/backups/20260528T120000");
    expect(draft.displayName).toBe("20260528T120000 (backup)");
    expect(draft.order).toBe(2);
  });
});

describe("createDraftFromImportPackage", () => {
  it("strips the package extension for the display name", () => {
    const draft = createDraftFromImportPackage("Notes.zip", [3], {
      filePath: "/tmp/Notes.zip",
    });
    expect(draft.source).toBe("import");
    expect(draft.displayName).toBe("Notes");
    expect(draft.importFilePath).toBe("/tmp/Notes.zip");
    expect(createVaultImportNeedsRename(draft)).toBe(false);
  });

  it("flags illegal import filenames for a rename", () => {
    const draft = createDraftFromImportPackage("Notes: 2026.zip", []);
    expect(createVaultImportNeedsRename(draft)).toBe(true);
    expect(draft.displayName).toBe("Notes_ 2026");
  });
});

describe("createDraftFor*Source", () => {
  it("opens the wizard on import or scratch without a file", () => {
    expect(createDraftForImportSource([]).source).toBe("import");
    expect(createDraftForScratchSource([]).source).toBe("scratch");
  });
});
