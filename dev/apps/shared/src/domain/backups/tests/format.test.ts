import { describe, expect, it } from "vitest";
import {
  backupBundleEntryName,
  backupEntryFileName,
  backupEntryKey,
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

  it("prefixes a pin in a bundle only when the unpinned zip has the same name", () => {
    const pin = { stamp: "20260927151022", fileName: "20260927151022-casis.zip", saved: true };
    const plain = { stamp: "20260927151022", fileName: "20260927151022-casis.zip" };
    expect(backupBundleEntryName(pin, "casis", [pin])).toBe("20260927151022-casis.zip");
    expect(backupBundleEntryName(pin, "casis", [plain, pin])).toBe(
      "saves-20260927151022-casis.zip",
    );
    expect(backupBundleEntryName(plain, "casis", [plain, pin])).toBe("20260927151022-casis.zip");
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
