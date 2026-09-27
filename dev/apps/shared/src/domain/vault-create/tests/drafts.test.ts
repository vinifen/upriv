import { describe, expect, it } from "vitest";
import { createDraftFromBackup } from "../createDraftFromBackup";
import {
  createDraftForImportSource,
  createDraftForScratchSource,
  createDraftFromImportPackage,
  createVaultImportNeedsRename,
} from "../createDraftFromImportPackage";
import {
  createVaultImportNeedsArchivePassword,
  createVaultImportPackage,
  importExtractApplies,
} from "../importKind";
import { importZipClassificationFromProbe } from "../zipClassification";

describe("createDraftFromBackup", () => {
  it("seeds import source with a backup-named display name", () => {
    const draft = createDraftFromBackup("20260528120000", "notes", "Notes", [1]);
    expect(draft.source).toBe("import");
    expect(draft.importKind).toBe("backup");
    expect(draft.importFilePath).toBe("vaults/notes/backups/20260528120000-notes.zip");
    expect(draft.importFileName).toBe("20260528120000-notes.zip");
    expect(draft.displayName).toBe("Notes backup");
    expect(draft.order).toBe(2);
    expect(draft.groupMode).toBe("none");
  });

  it("suffixes the backup name when that name is taken", () => {
    const draft = createDraftFromBackup("20260528120000", "notes", "Notes", [1], ["Notes backup"]);
    expect(draft.displayName).toBe("Notes backup 2");
  });

  it("uses the listed snapshot file as the locator", () => {
    const draft = createDraftFromBackup(
      "20260528120000",
      "notes",
      "Notes",
      [1],
      [],
      null,
      "20260528120000-old-notes.zip",
    );
    expect(draft.importFileName).toBe("20260528120000-old-notes.zip");
    expect(draft.importFilePath).toBe("vaults/notes/backups/20260528120000-old-notes.zip");
  });

  it("points a pin at backups/saves", () => {
    const draft = createDraftFromBackup(
      "20260528120000",
      "notes",
      "Notes",
      [1],
      [],
      null,
      "20260528120000-notes.zip",
      true,
    );
    expect(draft.importFileName).toBe("20260528120000-notes.zip");
    expect(draft.importFilePath).toBe("vaults/notes/backups/saves/20260528120000-notes.zip");
  });

  it("pre-selects the source vault group", () => {
    const draft = createDraftFromBackup("20260528120000", "notes", "Notes", [1], [], "work");
    expect(draft.groupMode).toBe("existing");
    expect(draft.groupId).toBe("work");
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

  it("suffixes a display name that already exists", () => {
    const draft = createDraftFromImportPackage("Notes.zip", [], {
      existingDisplayNames: ["Notes", "notes 2"],
    });
    expect(draft.displayName).toBe("Notes 3");
  });

  it("does not treat the filename as a filesystem path", () => {
    const draft = createDraftFromImportPackage("Notes.zip", []);
    expect(draft.importFileName).toBe("Notes.zip");
    expect(draft.importFilePath).toBe("");
    expect(draft.importShape).toBe("file");
  });

  it("keeps a dropped folder as a directory import", () => {
    const draft = createDraftFromImportPackage("Photos", [1], {
      filePath: "/tmp/Photos",
      shape: "directory",
    });
    expect(draft.importShape).toBe("directory");
    expect(draft.importFileName).toBe("Photos");
    expect(draft.importFilePath).toBe("/tmp/Photos");
    expect(draft.displayName).toBe("Photos");
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
          zipLayout: null,
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
          zipLayout: null,
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
          zipLayout: "store",
        },
        "",
      ),
    ).toEqual({
      kind: "store_zip",
      archivePath: undefined,
      archivePassword: undefined,
    });
    expect(
      createVaultImportPackage(
        {
          source: "import",
          importKind: "file",
          importFileName: "Photos.zip",
          importFilePath: "/tmp/Photos.zip",
          zipLayout: "files",
        },
        "secret",
      ),
    ).toEqual({
      kind: "files_zip",
      archivePath: "/tmp/Photos.zip",
      archivePassword: undefined,
    });
    expect(
      createVaultImportNeedsArchivePassword({
        source: "import",
        importKind: "file",
        importFileName: "Photos.zip",
      }),
    ).toBe(false);
    expect(
      createVaultImportPackage(
        {
          source: "import",
          importKind: "file",
          importFileName: "Photos.zip",
          importFilePath: "/tmp/Photos.zip",
          zipLayout: "files",
          importExtract: false,
        },
        "secret",
      ),
    ).toEqual({
      kind: "os_tree",
      archivePath: "/tmp/Photos.zip",
      archivePassword: undefined,
    });
    expect(
      createVaultImportPackage(
        {
          source: "import",
          importKind: "file",
          importShape: "directory",
          importFileName: "Photos",
          importFilePath: "/tmp/Photos",
          zipLayout: null,
        },
        "secret",
      ),
    ).toEqual({
      kind: "os_tree",
      archivePath: "/tmp/Photos",
      archivePassword: undefined,
    });
    expect(
      createVaultImportPackage(
        {
          source: "import",
          importKind: "file",
          importShape: "directory",
          importFileName: "Photos",
          importFilePath: "content://tree/photos",
          zipLayout: null,
        },
        "secret",
      ),
    ).toEqual({
      kind: "os_tree",
      archivePath: "content://tree/photos",
      archivePassword: undefined,
    });
    expect(
      createVaultImportNeedsArchivePassword({
        source: "import",
        importKind: "file",
        importFileName: "notes.7z",
        importExtract: false,
      }),
    ).toBe(false);
  });

  it("does not package a zip whose probe never returned a layout", () => {
    const draft = {
      source: "import" as const,
      importKind: "file" as const,
      importFileName: "Notes.zip",
      importFilePath: "/tmp/Notes.zip",
      importExtract: false,
      importZipProbeFailed: true,
    };
    expect(importExtractApplies(draft)).toBe(false);
    expect(() => createVaultImportPackage(draft, "secret")).toThrow(/not classified/);
  });
});

describe("importZipClassificationFromProbe", () => {
  it("treats a files zip as documents and a store zip as a copy", () => {
    expect(
      importZipClassificationFromProbe({ ok: true, kind: "files_zip", embedded: null }),
    ).toEqual({ embedded: null, zipLayout: "files" });
    expect(
      importZipClassificationFromProbe({ ok: true, kind: "store_zip", embedded: null }),
    ).toEqual({ embedded: null, zipLayout: "store" });
    expect(
      importZipClassificationFromProbe({ ok: false, kind: "store_zip", embedded: null }),
    ).toEqual({ embedded: null, zipLayout: "store" });
    expect(importZipClassificationFromProbe({ ok: false, kind: "files_zip", embedded: null })).toBe(
      null,
    );
  });
});
