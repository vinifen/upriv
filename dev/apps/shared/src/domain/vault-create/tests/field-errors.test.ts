import { describe, expect, it } from "vitest";
import { createVaultErrorsForField } from "../fieldErrors";

describe("createVaultErrorsForField", () => {
  it("keeps only the codes for that control", () => {
    expect(
      createVaultErrorsForField(["empty", "password_empty", "duplicate"], "displayName"),
    ).toEqual(["empty", "duplicate"]);
    expect(createVaultErrorsForField(["password_mismatch", "empty"], "passwordConfirm")).toEqual([
      "password_mismatch",
    ]);
  });

  it("returns nothing when the step errors are for other fields", () => {
    expect(createVaultErrorsForField(["password_empty"], "displayName")).toEqual([]);
  });

  it("keeps mount path codes under mount", () => {
    expect(
      createVaultErrorsForField(
        ["mount_path_empty", "mount_path_not_absolute", "password_empty"],
        "mount",
      ),
    ).toEqual(["mount_path_empty", "mount_path_not_absolute"]);
  });
});
