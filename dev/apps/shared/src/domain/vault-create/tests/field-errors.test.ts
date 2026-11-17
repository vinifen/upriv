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

  it("has no storage-step codes", () => {
    expect(createVaultErrorsForField(["password_empty"], "storage")).toEqual([]);
  });

  it("keeps each list's row code under its own field", () => {
    const codes = [
      "unlocked_folder_row_invalid",
      "backup_folder_row_invalid",
      "password_empty",
    ] as const;
    expect(createVaultErrorsForField([...codes], "unlockedFolder")).toEqual([
      "unlocked_folder_row_invalid",
    ]);
    expect(createVaultErrorsForField([...codes], "backupFolder")).toEqual([
      "backup_folder_row_invalid",
    ]);
  });
});
