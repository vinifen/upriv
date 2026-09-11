import { describe, expect, it } from "vitest";
import {
  canSubmitCreateVault,
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

  it("requires import file name for import source", () => {
    expect(
      validateCreateVaultStep(
        "source",
        createVaultDraftFixture([], { source: "import", importFileName: "" }),
        [],
      ),
    ).toContain("import_file_missing");
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

  it("rejects passwords shorter than 4 characters", () => {
    expect(
      validateCreateVaultStep(
        "password",
        createVaultDraftFixture([], { password: "abc", passwordConfirm: "abc" }),
        [],
      ),
    ).toContain("password_too_short");
  });

  it("measures create-vault password length after trim", () => {
    expect(
      validateCreateVaultStep(
        "password",
        createVaultDraftFixture([], { password: "  ab", passwordConfirm: "  ab" }),
        [],
      ),
    ).toContain("password_too_short");
    expect(
      validateCreateVaultStep(
        "password",
        createVaultDraftFixture([], { password: "  abcd  ", passwordConfirm: "  abcd  " }),
        [],
      ),
    ).toEqual([]);
  });

  it("rejects the prototype reserved password on scratch create", () => {
    expect(
      validateCreateVaultStep(
        "password",
        createVaultDraftFixture([], { password: "wrong", passwordConfirm: "wrong" }),
        [],
      ),
    ).toContain("password_wrong");
    expect(
      validateCreateVaultStep(
        "password",
        createVaultDraftFixture([], { password: "  wrong  ", passwordConfirm: "  wrong  " }),
        [],
      ),
    ).toContain("password_wrong");
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
