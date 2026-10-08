import { describe, expect, it } from "vitest";
import { backupDeleteConfirmPhrase, matchesBackupDeleteConfirmation } from "../deleteConfirm";

describe("backupDeleteConfirmPhrase", () => {
  it("joins the current display name and the count", () => {
    expect(backupDeleteConfirmPhrase("Notes", 1)).toBe("Notes 1");
    expect(backupDeleteConfirmPhrase("My vault", 12)).toBe("My vault 12");
    expect(backupDeleteConfirmPhrase("notes2", 2)).toBe("notes2 2");
    expect(backupDeleteConfirmPhrase("  Notes ", 2)).toBe("Notes 2");
  });
});

describe("matchesBackupDeleteConfirmation", () => {
  it("accepts the exact phrase, ignoring outer whitespace", () => {
    expect(matchesBackupDeleteConfirmation("Notes 2", "Notes", 2)).toBe(true);
    expect(matchesBackupDeleteConfirmation("  Notes 2 ", "Notes", 2)).toBe(true);
  });

  it("rejects a wrong count, name, case, or the old phrases", () => {
    expect(matchesBackupDeleteConfirmation("Notes 1", "Notes", 2)).toBe(false);
    expect(matchesBackupDeleteConfirmation("Notes2", "Notes", 2)).toBe(false);
    expect(matchesBackupDeleteConfirmation("notes 2", "Notes", 2)).toBe(false);
    expect(matchesBackupDeleteConfirmation("delete 2", "Notes", 2)).toBe(false);
    expect(matchesBackupDeleteConfirmation("notes", "Notes", 1)).toBe(false);
    expect(matchesBackupDeleteConfirmation("Notes 0", "Notes", 0)).toBe(false);
  });
});
