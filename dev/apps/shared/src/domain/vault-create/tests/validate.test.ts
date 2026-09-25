import { describe, expect, it } from "vitest";
import {
  canSubmitCreateVault,
  isLifecyclePasswordPresent,
  isMockLifecyclePasswordValid,
  validateCreateVaultStep,
  validateAllCreateVaultSteps,
} from "..";
import { createVaultDraftFixture } from "./fixtures";

describe("validateCreateVaultStep", () => {
  it("requires source on source step", () => {
    expect(
      validateCreateVaultStep("source", createVaultDraftFixture([], { source: null }), []),
    ).toEqual(["source_missing"]);
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
          importKind: "backup",
          importFileName: "20260528T120000",
          importFilePath: "vaults/notes/backups/20260528T120000",
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
          importFileName: "20260528T120000",
          importFilePath: "vaults/notes/backups/20260528T120000",
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

  it("skips archive password for zip and backup imports", () => {
    expect(
      validateCreateVaultStep(
        "password",
        createVaultDraftFixture([], {
          source: "import",
          importKind: "file",
          importFileName: "notes.zip",
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
          importKind: "backup",
          importFileName: "20260528T120000",
          importFilePath: "vaults/notes/backups/20260528T120000",
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

  it("rejects a relative custom mount path", () => {
    const draft = createVaultDraftFixture([], {
      mount: { workspace_path: "relative/path" },
    });
    expect(validateCreateVaultStep("advanced", draft, [])).toContain("mount_path_not_absolute");
    expect(canSubmitCreateVault(draft, [])).toBe(false);
  });

  it("rejects an empty custom mount path", () => {
    const draft = createVaultDraftFixture([], {
      mount: { workspace_path: "" },
    });
    expect(validateCreateVaultStep("advanced", draft, [])).toContain("mount_path_empty");
    expect(canSubmitCreateVault(draft, [])).toBe(false);
  });

  it("rejects a reserved path under vault-root", () => {
    const draft = createVaultDraftFixture([], {
      mount: { workspace_path: "/data/.upriv/vaults" },
    });
    expect(validateCreateVaultStep("advanced", draft, [], [], "/data")).toContain(
      "mount_path_reserved",
    );
    expect(canSubmitCreateVault(draft, [], [], "/data")).toBe(false);
  });

  it("rejects absolute custom mount when vault-root is unknown", () => {
    const draft = createVaultDraftFixture([], {
      mount: { workspace_path: "/home/user/workspace" },
    });
    expect(validateCreateVaultStep("advanced", draft, [], [], null)).toContain(
      "mount_path_root_unknown",
    );
    expect(canSubmitCreateVault(draft, [], [], null)).toBe(false);
  });

  it("refuses upriv_plain until wipe exists", () => {
    const draft = createVaultDraftFixture([], {
      storage: { mode: "upriv_plain" },
    });
    expect(validateCreateVaultStep("advanced", draft, [])).toContain("plain_not_available");
    expect(canSubmitCreateVault(draft, [])).toBe(false);
  });

  it("still submits when mount is default", () => {
    const draft = createVaultDraftFixture([], {
      mount: { workspace_path: "default" },
    });
    expect(validateCreateVaultStep("advanced", draft, [], [], "/data")).toEqual([]);
    expect(canSubmitCreateVault(draft, [], [], "/data")).toBe(true);
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
