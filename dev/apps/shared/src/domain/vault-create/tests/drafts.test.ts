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
  createVaultSettingsLocked,
  importExtractApplies,
  importKeepSettingsApplies,
  importKeepWorkspaceApplies,
  importUsesCarriedSettings,
} from "../importKind";
import type { CreateVaultDraft, CreateVaultStepId } from "../types";
import {
  canSubmitCreateVault,
  getCreateVaultStepStatus,
  validateCreateVaultStep,
} from "../validate";
import { importZipClassificationFromProbe } from "../zipClassification";
import { createVaultDraftFixture, vaultSettingsFixture } from "./fixtures";

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
        importFileName: "20260528120000-notes.zip",
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
          importFileName: "20260528120000-notes.zip",
          importFilePath: "vaults/notes/backups/20260528120000-notes.zip",
          zipLayout: null,
        },
        "secret",
      ),
    ).toEqual({
      kind: "store_zip",
      archivePath: "vaults/notes/backups/20260528120000-notes.zip",
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
      keepWorkspace: false,
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
      keepWorkspace: false,
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
      createVaultImportPackage(
        {
          source: "import",
          importKind: "file",
          importShape: "file",
          importFileName: "notes.pdf",
          importFilePath: "content://doc/notes.pdf",
          zipLayout: null,
        },
        "secret",
      ),
    ).toEqual({
      kind: "os_tree",
      archivePath: "content://doc/notes.pdf",
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
  const probed = (ok: boolean, kind: string) => ({
    ok,
    kind,
    embedded: null,
    carriesWorkspace: false,
  });

  it("treats a files zip as documents and a store zip as a copy", () => {
    expect(importZipClassificationFromProbe(probed(true, "files_zip"))).toEqual({
      embedded: null,
      zipLayout: "files",
      carriesWorkspace: false,
    });
    expect(importZipClassificationFromProbe(probed(true, "store_zip"))).toEqual({
      embedded: null,
      zipLayout: "store",
      carriesWorkspace: false,
    });
    expect(importZipClassificationFromProbe(probed(false, "store_zip"))).toEqual({
      embedded: null,
      zipLayout: "store",
      carriesWorkspace: false,
    });
    expect(importZipClassificationFromProbe(probed(false, "files_zip"))).toBe(null);
  });

  it("keeps what a plain-text zip carries", () => {
    const embedded = { settings: vaultSettingsFixture(), unlockPreset: null };
    expect(
      importZipClassificationFromProbe({
        ok: true,
        kind: "files_zip",
        embedded,
        carriesWorkspace: true,
      }),
    ).toEqual({ embedded, zipLayout: "files", carriesWorkspace: true });
  });
});

describe("the .upriv-config switches", () => {
  const sevenZip = createVaultDraftFixture([], {
    source: "import",
    importFileName: "Notes.7z",
    importFilePath: "/tmp/Notes.7z",
  });
  const plainZip = createVaultDraftFixture([], {
    source: "import",
    importFileName: "Notes plain text.zip",
    importFilePath: "/tmp/Notes plain text.zip",
    zipLayout: "files",
    importCarriesWorkspace: true,
    importCarriesSettings: true,
  });

  it("shows both on a .7z, which cannot be read before its password", () => {
    expect(importKeepWorkspaceApplies(sevenZip)).toBe(true);
    expect(importKeepSettingsApplies(sevenZip)).toBe(true);
    expect(importKeepWorkspaceApplies({ ...sevenZip, importExtract: false })).toBe(false);
    expect(importKeepSettingsApplies({ ...sevenZip, importExtract: false })).toBe(false);
  });

  it("shows each one on a .zip only when the file carries it", () => {
    expect(importKeepWorkspaceApplies(plainZip)).toBe(true);
    expect(importKeepSettingsApplies(plainZip)).toBe(true);
    const ordinary = { ...plainZip, importCarriesWorkspace: false, importCarriesSettings: false };
    expect(importKeepWorkspaceApplies(ordinary)).toBe(false);
    expect(importKeepSettingsApplies(ordinary)).toBe(false);
  });

  it("does not show on an encrypted vault zip", () => {
    const store = { ...plainZip, zipLayout: "store" as const };
    expect(importKeepWorkspaceApplies(store)).toBe(false);
    expect(importKeepSettingsApplies(store)).toBe(false);
  });

  it("sends the layout choice with a .7z and a .zip of files only", () => {
    expect(createVaultImportPackage(sevenZip, "secret")?.keepWorkspace).toBe(true);
    expect(createVaultImportPackage(plainZip, "secret")?.keepWorkspace).toBe(true);
    expect(
      createVaultImportPackage({ ...plainZip, importKeepWorkspace: false }, "secret")
        ?.keepWorkspace,
    ).toBe(false);
    expect(
      createVaultImportPackage({ ...plainZip, zipLayout: "store" }, "secret")?.keepWorkspace,
    ).toBeUndefined();
  });

  it("keeps a store copy on its settings with no switch to turn off", () => {
    expect(importUsesCarriedSettings({ ...plainZip, zipLayout: "store" })).toBe(true);
    expect(
      importUsesCarriedSettings({
        source: "import",
        importKind: "backup",
        importKeepSettings: false,
      }),
    ).toBe(true);
    expect(importUsesCarriedSettings({ ...plainZip, importKeepSettings: false })).toBe(false);
    expect(importUsesCarriedSettings({ ...plainZip, importExtract: false })).toBe(false);
  });
});

describe("createVaultSettingsLocked", () => {
  const sevenZip = createVaultDraftFixture([], {
    source: "import",
    importFileName: "Notes.7z",
    importFilePath: "/tmp/Notes.7z",
    displayName: "",
  });

  it("locks a .7z until its password test passes", () => {
    expect(createVaultSettingsLocked(sevenZip)).toBe(true);
    expect(createVaultSettingsLocked({ ...sevenZip, passwordValidated: true })).toBe(false);
  });

  it("does not lock when the file's settings are turned off, or it is stored whole", () => {
    expect(createVaultSettingsLocked({ ...sevenZip, importKeepSettings: false })).toBe(false);
    expect(createVaultSettingsLocked({ ...sevenZip, importExtract: false })).toBe(false);
  });

  it("does not lock any other import", () => {
    expect(
      createVaultSettingsLocked(
        createVaultDraftFixture([], {
          source: "import",
          importFileName: "Notes.zip",
          importFilePath: "/tmp/Notes.zip",
          zipLayout: "files",
        }),
      ),
    ).toBe(false);
    expect(createVaultSettingsLocked(createVaultDraftFixture())).toBe(false);
  });

  it("lets the person walk past the locked name, then asks for it once it can be typed", () => {
    expect(validateCreateVaultStep("identity", sevenZip, [])).toEqual([]);
    expect(
      validateCreateVaultStep("identity", { ...sevenZip, passwordValidated: true }, []),
    ).toEqual(["empty"]);
    expect(canSubmitCreateVault(sevenZip, [])).toBe(false);
  });

  it("shows the locked steps as waiting, not ready, until the test passes", () => {
    const status = (step: CreateVaultStepId, draft: CreateVaultDraft) =>
      getCreateVaultStepStatus(step, draft, [], new Set(), false);
    expect(status("identity", sevenZip)).toBe("waiting");
    expect(status("general", sevenZip)).toBe("waiting");
    expect(status("advanced", sevenZip)).toBe("waiting");
    expect(status("password", sevenZip)).toBe("incomplete");
    expect(status("general", { ...sevenZip, passwordValidated: true })).toBe("ready");
  });
});
