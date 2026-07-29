import { describe, expect, it } from "vitest";
import {
  canSubmitCreateVault,
  validateCreateVaultStep,
  validateAllCreateVaultSteps,
} from "..";
import { createVaultDraftFixture } from "./fixtures";

describe("validateCreateVaultStep", () => {
  it("requires source on source step", () => {
    expect(validateCreateVaultStep("source", createVaultDraftFixture([], { source: null }), [])).toEqual(
      ["source_missing"],
    );
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
      validateCreateVaultStep("identity", createVaultDraftFixture([], { displayName: "My Vault" }), [
        "my-vault",
      ]),
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
});
