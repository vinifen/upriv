import { describe, expect, it } from "vitest";
import {
  BACKUP_NAME_MAX_CHARS,
  backupExportFilename,
  backupExportRowKey,
  normalizeBackupName,
} from "../format";

describe("backupExportFilename", () => {
  it("keeps the name of one backup, a pin and a named one too", () => {
    expect(backupExportFilename(["data/20260927151022-casis.zip"], "casis")).toBe(
      "20260927151022-casis.zip",
    );
    expect(backupExportFilename(["f1/saves/20260927151022-casis Trip.zip"], "casis")).toBe(
      "20260927151022-casis Trip.zip",
    );
  });

  it("names a bundle of several for the vault", () => {
    const keys = ["data/20260927151022-casis.zip", "f1/20260928151022-casis.zip"];
    expect(backupExportFilename(keys, "casis")).toBe("upriv-backups-casis.zip");
  });

  it("adds the number core takes when the name is in the folder", () => {
    expect(backupExportFilename(["data/20260927151022-casis.zip"], "casis", 2)).toBe(
      "20260927151022-casis-2.zip",
    );
    expect(backupExportFilename(["data/a.zip", "data/b.zip"], "casis", 3)).toBe(
      "upriv-backups-casis-3.zip",
    );
  });
});

describe("backupExportRowKey", () => {
  it("is the backup's own row for one, and no row for several", () => {
    expect(backupExportRowKey(["data/saves/a.zip"])).toBe("data/saves/a.zip");
    expect(backupExportRowKey(["data/a.zip", "data/b.zip"])).toBeNull();
  });
});

describe("normalizeBackupName", () => {
  it("trims and caps a name", () => {
    expect(normalizeBackupName("  Before the trip  ")).toBe("Before the trip");
    expect(Array.from(normalizeBackupName("é".repeat(BACKUP_NAME_MAX_CHARS + 3)))).toHaveLength(
      BACKUP_NAME_MAX_CHARS,
    );
  });
});
