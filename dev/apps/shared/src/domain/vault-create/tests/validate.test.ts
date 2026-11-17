import { describe, expect, it } from "vitest";
import {
  canSubmitCreateVault,
  isLifecyclePasswordPresent,
  isMockLifecyclePasswordValid,
  validateCreateVaultStep,
  validateAllCreateVaultSteps,
  type CreateVaultLists,
} from "..";
import type { AppUnlockedFolders, DeviceGroups, HereDevice } from "../../folder-lists";
import { createVaultDraftFixture } from "./fixtures";

const HERE = "a".repeat(32);
const DESK: HereDevice = { id: HERE, system: "linux" };
const APP_UNLOCKED_OFF: AppUnlockedFolders = { encrypted_vaults: false, devices: {} };

/** The lists a new vault joins on `here`, with the app's unlocked folders as given. */
function lists(
  appUnlocked: AppUnlockedFolders = APP_UNLOCKED_OFF,
  here: HereDevice = DESK,
): CreateVaultLists {
  return { here, appUnlocked };
}

/** This device's group with one selected row at `path`. */
function rowsHere<F extends string>(path: string): DeviceGroups<F> {
  return {
    [HERE]: {
      system: "linux",
      selected: 1,
      next_number: 2,
      rows: [{ number: 1, name: "", path }],
    },
  };
}

describe("validateCreateVaultStep", () => {
  it("requires source on source step", () => {
    expect(
      validateCreateVaultStep("source", createVaultDraftFixture([], { source: null }), []),
    ).toEqual(["source_missing"]);
  });

  it("waits for a .zip to be classified, then accepts store or files", () => {
    expect(
      validateCreateVaultStep(
        "source",
        createVaultDraftFixture([], {
          source: "import",
          importFileName: "Photos.zip",
          importFilePath: "/tmp/Photos.zip",
        }),
        [],
      ),
    ).toEqual(["import_zip_pending"]);
    expect(
      validateCreateVaultStep(
        "source",
        createVaultDraftFixture([], {
          source: "import",
          importFileName: "Photos.zip",
          importFilePath: "/tmp/Photos.zip",
          importZipRejected: true,
        }),
        [],
      ),
    ).toEqual(["import_zip_rejected"]);
    expect(
      validateCreateVaultStep(
        "source",
        createVaultDraftFixture([], {
          source: "import",
          importFileName: "Photos.zip",
          importFilePath: "/tmp/Photos.zip",
          importZipProbeFailed: true,
          importExtract: false,
        }),
        [],
      ),
    ).toEqual(["import_zip_rejected"]);
    expect(
      validateCreateVaultStep(
        "source",
        createVaultDraftFixture([], {
          source: "import",
          importFileName: "Photos.zip",
          importFilePath: "/tmp/Photos.zip",
          zipLayout: "files",
        }),
        [],
      ),
    ).toEqual([]);
    expect(
      validateCreateVaultStep(
        "source",
        createVaultDraftFixture([], {
          source: "import",
          importFileName: "Notes.zip",
          importFilePath: "/tmp/Notes.zip",
          zipLayout: "store",
        }),
        [],
      ),
    ).toEqual([]);
  });

  it("accepts a normal file, a folder, and a rejected zip stored whole", () => {
    expect(
      validateCreateVaultStep(
        "source",
        createVaultDraftFixture([], {
          source: "import",
          importFileName: "notes.txt",
          importFilePath: "/tmp/notes.txt",
        }),
        [],
      ),
    ).toEqual([]);
    expect(
      validateCreateVaultStep(
        "source",
        createVaultDraftFixture([], {
          source: "import",
          importShape: "directory",
          importFileName: "Photos",
          importFilePath: "/tmp/Photos",
        }),
        [],
      ),
    ).toEqual([]);
    expect(
      validateCreateVaultStep(
        "source",
        createVaultDraftFixture([], {
          source: "import",
          importFileName: "Photos.zip",
          importFilePath: "/tmp/Photos.zip",
          importZipRejected: true,
          importExtract: false,
        }),
        [],
      ),
    ).toEqual([]);
    expect(
      validateCreateVaultStep(
        "password",
        createVaultDraftFixture([], {
          source: "import",
          importFileName: "notes.txt",
          importFilePath: "/tmp/notes.txt",
          password: "",
          passwordConfirm: "",
        }),
        [],
      ),
    ).toContain("password_empty");
  });

  it("requires an import file on the source step", () => {
    expect(
      validateCreateVaultStep(
        "source",
        createVaultDraftFixture([], { source: "import", importFileName: "" }),
        [],
      ),
    ).toContain("import_file_missing");
    expect(
      validateCreateVaultStep(
        "source",
        createVaultDraftFixture([], { source: "import", importFileName: "backup.zip" }),
        [],
      ),
    ).toContain("import_file_missing");
    expect(
      validateCreateVaultStep(
        "source",
        createVaultDraftFixture([], {
          source: "import",
          importFileName: "backup.zip",
          importFilePath: "/tmp/backup.zip",
          zipLayout: "store",
        }),
        [],
      ),
    ).not.toContain("import_file_missing");
    expect(
      validateCreateVaultStep(
        "source",
        createVaultDraftFixture([], {
          source: "import",
          importFileName: "backup.zip",
          importFilePath: "content://com.android.externalstorage/document/zip",
        }),
        [],
      ),
    ).toContain("import_file_missing");
    expect(
      validateCreateVaultStep(
        "source",
        createVaultDraftFixture([], {
          source: "import",
          importShape: "directory",
          importFileName: "Photos",
          importFilePath: "content://com.android.externalstorage.documents/tree/primary",
        }),
        [],
      ),
    ).not.toContain("import_file_missing");
    expect(
      validateCreateVaultStep(
        "source",
        createVaultDraftFixture([], {
          source: "import",
          importKind: "backup",
          importFileName: "20260528120000-notes.zip",
          importFilePath: "vaults/notes/backups/20260528120000-notes.zip",
        }),
        [],
      ),
    ).not.toContain("import_file_missing");
  });

  it("allows backup import while other vaults stay open", () => {
    expect(
      validateCreateVaultStep(
        "source",
        createVaultDraftFixture([], {
          source: "import",
          importKind: "backup",
          importFileName: "20260528120000-notes.zip",
          importFilePath: "vaults/notes/backups/20260528120000-notes.zip",
        }),
        [],
      ),
    ).toEqual([]);
  });

  it("rejects duplicate vault id on identity step", () => {
    expect(
      validateCreateVaultStep(
        "identity",
        createVaultDraftFixture([], { displayName: "My Vault" }),
        ["my-vault"],
      ),
    ).toContain("duplicate");
  });

  it("requires password match on scratch password step", () => {
    expect(
      validateCreateVaultStep(
        "password",
        createVaultDraftFixture([], { passwordConfirm: "other" }),
        [],
      ),
    ).toContain("password_mismatch");
  });

  it("allows short and reserved mock passwords on live create", () => {
    expect(
      validateCreateVaultStep(
        "password",
        createVaultDraftFixture([], { password: "abc", passwordConfirm: "abc" }),
        [],
      ),
    ).toEqual([]);
    expect(
      validateCreateVaultStep(
        "password",
        createVaultDraftFixture([], { password: "wrong", passwordConfirm: "wrong" }),
        [],
      ),
    ).toEqual([]);
  });

  it("measures create-vault empty-detect with trim only", () => {
    expect(
      validateCreateVaultStep(
        "password",
        createVaultDraftFixture([], { password: "  ab", passwordConfirm: "  ab" }),
        [],
      ),
    ).toEqual([]);
    expect(
      validateCreateVaultStep(
        "password",
        createVaultDraftFixture([], { password: "   ", passwordConfirm: "   " }),
        [],
      ),
    ).toContain("password_empty");
  });

  it("requires validated password on import password step", () => {
    expect(
      validateCreateVaultStep(
        "password",
        createVaultDraftFixture([], {
          source: "import",
          importFileName: "backup.7z",
          passwordValidated: false,
        }),
        [],
      ),
    ).toContain("password_not_validated");
  });

  it("skips archive password for a store zip and a backup, and requires one for documents", () => {
    expect(
      validateCreateVaultStep(
        "password",
        createVaultDraftFixture([], {
          source: "import",
          importKind: "file",
          importFileName: "notes.zip",
          zipLayout: "store",
          password: "",
          passwordValidated: false,
        }),
        [],
      ),
    ).toEqual([]);
    expect(
      validateCreateVaultStep(
        "password",
        createVaultDraftFixture([], {
          source: "import",
          importKind: "file",
          importFileName: "Photos.zip",
          zipLayout: "files",
          password: "",
          passwordConfirm: "",
        }),
        [],
      ),
    ).toContain("password_empty");
    expect(
      validateCreateVaultStep(
        "password",
        createVaultDraftFixture([], {
          source: "import",
          importKind: "backup",
          importFileName: "20260528120000-notes.zip",
          importFilePath: "vaults/notes/backups/20260528120000-notes.zip",
          password: "",
          passwordValidated: false,
        }),
        [],
      ),
    ).toEqual([]);
  });

  it("surfaces probe-unavailable separately from a wrong archive password", () => {
    expect(
      validateCreateVaultStep(
        "password",
        createVaultDraftFixture([], {
          source: "import",
          importFileName: "notes.7z",
          password: "secret",
          passwordValidated: false,
          passwordProbeUnavailable: true,
        }),
        [],
      ),
    ).toEqual(["import_probe_unavailable"]);
  });

  it("requires a group id when assigning to an existing group", () => {
    expect(
      validateCreateVaultStep(
        "general",
        createVaultDraftFixture([], { groupMode: "existing", groupId: "" }),
        [],
      ),
    ).toContain("group_missing");
  });

  it("rejects a stale existing group id", () => {
    expect(
      validateCreateVaultStep(
        "general",
        createVaultDraftFixture([], { groupMode: "existing", groupId: "gone" }),
        [],
        ["work"],
      ),
    ).toContain("group_missing");
  });

  it("requires a group name when creating a group on finalize", () => {
    expect(
      validateCreateVaultStep(
        "general",
        createVaultDraftFixture([], { groupMode: "create", groupName: "" }),
        [],
      ),
    ).toContain("group_name_empty");
  });

  it("refuses a backup row of any device whose path cannot be used", () => {
    const withFolder = (path: string) => {
      const draft = createVaultDraftFixture();
      return {
        ...draft,
        backup: { ...draft.backup, devices: rowsHere<"inherit" | "data_folder">(path) },
      };
    };
    for (const path of ["", "usb", "/data/.upriv/x", "/mnt/upriv-unlocked/x"]) {
      expect(validateCreateVaultStep("general", withFolder(path), [], [], lists()), path).toContain(
        "backup_folder_row_invalid",
      );
    }
    expect(validateCreateVaultStep("general", withFolder("/mnt/usb"), [], [], lists())).toEqual([]);
    // Core writes a new vault's lists as they are: another device's rows are
    // checked too, against that device's system.
    const laptop = lists(APP_UNLOCKED_OFF, { ...DESK, id: "b".repeat(32) });
    expect(validateCreateVaultStep("general", withFolder("usb"), [], [], laptop)).toEqual([
      "backup_folder_row_invalid",
    ]);
    expect(validateCreateVaultStep("general", withFolder("/mnt/usb"), [], [], laptop)).toEqual([]);
  });

  it("has nothing to check while backups follow the app default", () => {
    const draft = createVaultDraftFixture();
    expect(validateCreateVaultStep("general", draft, [])).toEqual([]);
  });
});

describe("canSubmitCreateVault", () => {
  it("returns true for a complete scratch draft", () => {
    expect(canSubmitCreateVault(createVaultDraftFixture(), [])).toBe(true);
  });

  it("returns false when any step has errors", () => {
    const errors = validateAllCreateVaultSteps(
      createVaultDraftFixture([], { displayName: "" }),
      [],
    );
    expect(Object.keys(errors).length).toBeGreaterThan(0);
    expect(canSubmitCreateVault(createVaultDraftFixture([], { displayName: "" }), [])).toBe(false);
  });

  it("refuses an unlocked folder row of this device whose path cannot be used", () => {
    const withFolder = (path: string) =>
      createVaultDraftFixture([], {
        unlocked_folder: { encrypted: "inherit", devices: rowsHere<"inherit">(path) },
      });
    expect(validateCreateVaultStep("advanced", withFolder("relative"), [], [], lists())).toEqual([
      "unlocked_folder_row_invalid",
    ]);
    expect(canSubmitCreateVault(withFolder("relative"), [], [], lists())).toBe(false);
    expect(validateCreateVaultStep("advanced", withFolder("/mnt/ssd"), [], [], lists())).toEqual(
      [],
    );
  });

  it("accepts a vault that uses the app's unlocked folder", () => {
    const draft = createVaultDraftFixture();
    expect(validateCreateVaultStep("advanced", draft, [], [], lists())).toEqual([]);
    expect(canSubmitCreateVault(draft, [], [], lists())).toBe(true);
  });

  it("waits for a folder when the draft turns the vault's folder on and none is chosen here", () => {
    const on = createVaultDraftFixture([], {
      unlocked_folder: { encrypted: "on", devices: {} },
    });
    expect(validateCreateVaultStep("advanced", on, [], [], lists())).toEqual([
      "unlocked_folder_unchosen",
    ]);
    expect(canSubmitCreateVault(on, [], [], lists())).toBe(false);

    // A row of its own, or a folder the app chose here, gives it one.
    const withRow = createVaultDraftFixture([], {
      unlocked_folder: { encrypted: "on", devices: rowsHere<"inherit">("/mnt/ssd") },
    });
    expect(validateCreateVaultStep("advanced", withRow, [], [], lists())).toEqual([]);
    const beside: AppUnlockedFolders = {
      encrypted_vaults: false,
      devices: {
        [HERE]: { system: "linux", selected: "beside", next_number: 1, rows: [] },
      },
    };
    expect(validateCreateVaultStep("advanced", on, [], [], lists(beside))).toEqual([]);

    // A phone mounts no encrypted vault's folder; a plain-text vault asks where at its open.
    const phone = lists(APP_UNLOCKED_OFF, { ...DESK, system: "android" });
    expect(validateCreateVaultStep("advanced", on, [], [], phone)).toEqual([]);
    const plain = {
      ...on,
      storage: { mode: "upriv_plain" as const, plain_files: "chosen" as const },
    };
    expect(validateCreateVaultStep("advanced", plain, [], [], lists())).toEqual([]);
  });

  it("leaves a vault that follows the app's switch to the app's own settings", () => {
    const appOn: AppUnlockedFolders = { encrypted_vaults: true, devices: {} };
    const draft = createVaultDraftFixture();
    expect(validateCreateVaultStep("advanced", draft, [], [], lists(appOn))).toEqual([]);
  });

  it("allows upriv_plain on the advanced step", () => {
    const draft = createVaultDraftFixture([], {
      storage: { mode: "upriv_plain", plain_files: "chosen" },
    });
    expect(validateCreateVaultStep("advanced", draft, [])).toEqual([]);
    expect(canSubmitCreateVault(draft, [])).toBe(true);
  });
});

describe("isMockLifecyclePasswordValid", () => {
  it.each([
    ["pass", true],
    ["  abcd  ", true],
    ["  ab", false],
    ["abc", false],
    ["", false],
    ["   ", false],
    ["wrong", false],
    ["  wrong  ", false],
  ])("%j → %s", (password, expected) => {
    expect(isMockLifecyclePasswordValid(password)).toBe(expected);
  });
});

describe("isLifecyclePasswordPresent", () => {
  it.each([
    ["pass", true],
    ["  abcd  ", true],
    ["  ab", true],
    ["wrong", true],
    ["", false],
    ["   ", false],
  ])("%j → %s", (password, expected) => {
    expect(isLifecyclePasswordPresent(password)).toBe(expected);
  });
});
