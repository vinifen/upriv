import { describe, expect, it } from "vitest";
import {
  backupEntryFileName,
  backupEntryKey,
  backupExportFilename,
  backupExportRowKey,
  backupSnapshotFileName,
} from "../format";

describe("backupSnapshotFileName", () => {
  it("puts the vault id after the stamp", () => {
    expect(backupSnapshotFileName("20260927151022", "casis")).toBe("20260927151022-casis.zip");
  });
});

describe("backupEntryFileName", () => {
  it("uses the listed file, and the same rule when the list omits it", () => {
    expect(
      backupEntryFileName(
        { stamp: "20260927151022", fileName: "20260927151022-old-id.zip" },
        "casis",
      ),
    ).toBe("20260927151022-old-id.zip");
    expect(backupEntryFileName({ stamp: "20260927151022" }, "casis")).toBe(
      "20260927151022-casis.zip",
    );
  });

  it("puts a pin under saves so it does not share a key with the unpinned zip", () => {
    const entry = { stamp: "20260927151022", fileName: "20260927151022-casis.zip" };
    expect(backupEntryKey(entry, "casis")).toBe("20260927151022-casis.zip");
    expect(backupEntryKey({ ...entry, saved: true }, "casis")).toBe(
      "saves/20260927151022-casis.zip",
    );
  });

  it("ignores a listed name that is not a single file", () => {
    expect(
      backupEntryFileName(
        { stamp: "20260927151022", fileName: "../20260927151022-casis.zip" },
        "casis",
      ),
    ).toBe("20260927151022-casis.zip");
  });
});

describe("backupExportFilename", () => {
  it("keeps the name of one backup, a pin too", () => {
    expect(backupExportFilename(["20260927151022-casis.zip"], "casis")).toBe(
      "20260927151022-casis.zip",
    );
    expect(backupExportFilename(["saves/20260927151022-casis.zip"], "casis")).toBe(
      "20260927151022-casis.zip",
    );
  });

  it("names a bundle of several for the vault", () => {
    const keys = ["20260927151022-casis.zip", "20260928151022-casis.zip"];
    expect(backupExportFilename(keys, "casis")).toBe("upriv-backups-casis.zip");
  });

  it("adds the number core takes when the name is in the folder", () => {
    expect(backupExportFilename(["20260927151022-casis.zip"], "casis", 2)).toBe(
      "20260927151022-casis 2.zip",
    );
    expect(backupExportFilename(["a.zip", "b.zip"], "casis", 3)).toBe("upriv-backups-casis 3.zip");
  });
});

describe("backupExportRowKey", () => {
  it("is the backup's own row for one, and no row for several", () => {
    expect(backupExportRowKey(["saves/a.zip"])).toBe("saves/a.zip");
    expect(backupExportRowKey(["a.zip", "b.zip"])).toBeNull();
  });
});
