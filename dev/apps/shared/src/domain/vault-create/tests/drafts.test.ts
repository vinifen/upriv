import { describe, expect, it } from "vitest";
import { createDraftFromBackup } from "../createDraftFromBackup";
import {
  createDraftForImportSource,
  createDraftForScratchSource,
  createDraftFromImportPackage,
  createVaultImportNeedsRename,
} from "../createDraftFromImportPackage";
import { createVaultImportNeedsArchivePassword, createVaultImportPackage } from "../importKind";

describe("createDraftFromBackup", () => {
  it("seeds import source with a backup-named display name", () => {
    const draft = createDraftFromBackup("20260528T120000", "notes", [1]);
    expect(draft.source).toBe("import");
    expect(draft.importKind).toBe("backup");
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
    expect(draft.importKind).toBe("file");
    expect(draft.displayName).toBe("Notes");
    expect(draft.importFilePath).toBe("/tmp/Notes.zip");
    expect(createVaultImportNeedsRename(draft)).toBe(false);
  });

  it("does not treat the filename as a filesystem path", () => {
    const draft = createDraftFromImportPackage("Notes.zip", []);
    expect(draft.importFileName).toBe("Notes.zip");
    expect(draft.importFilePath).toBe("");
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

describe("createVaultImportPackage", () => {
  it("skips archive password for zip and backup copies", () => {
    expect(
      createVaultImportNeedsArchivePassword({
        source: "import",
        importKind: "backup",
        importFileName: "20260528T120000",
      }),
    ).toBe(false);
    expect(
      createVaultImportNeedsArchivePassword({
        source: "import",
        importKind: "file",
        importFileName: "notes.zip",
      }),
    ).toBe(false);
    expect(
      createVaultImportNeedsArchivePassword({
        source: "import",
        importKind: "file",
        importFileName: "notes.7z",
      }),
    ).toBe(true);

    expect(
      createVaultImportPackage(
        {
          source: "import",
          importKind: "backup",
          importFileName: "20260528T120000",
          importFilePath: "vaults/notes/backups/20260528T120000",
        },
        "secret",
      ),
    ).toEqual({
      kind: "store_zip",
      archivePath: "vaults/notes/backups/20260528T120000",
      archivePassword: undefined,
    });
    expect(
      createVaultImportPackage(
        {
          source: "import",
          importKind: "file",
          importFileName: "notes.7z",
          importFilePath: "/tmp/notes.7z",
        },
        "secret",
      ),
    ).toEqual({
      kind: "seven_zip",
      archivePath: "/tmp/notes.7z",
      archivePassword: "secret",
    });
    expect(
      createVaultImportPackage(
        {
          source: "import",
          importKind: "file",
          importFileName: "Notes.zip",
          importFilePath: "Notes.zip",
        },
        "",
      ),
    ).toEqual({
      kind: "store_zip",
      archivePath: undefined,
      archivePassword: undefined,
    });
  });
});
