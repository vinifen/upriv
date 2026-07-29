import { describe, expect, it } from "vitest";
import { getMockBackupBytes, getMockBackupsForVault } from "../backups";

describe("getMockBackupsForVault", () => {
  it("returns empty for unknown vault", () => {
    expect(getMockBackupsForVault("no-such-vault")).toEqual([]);
  });

  it("sorts by createdAt descending", () => {
    const list = getMockBackupsForVault("my-encrypted-notes");
    expect(list.map((b) => b.filename)).toEqual([
      "20260528T120000-my-encrypted-notes.7z",
      "20260515T090000-my-encrypted-notes.7z",
      "20260401T100000-my-encrypted-notes.7z",
    ]);
    expect(list[2]?.saved).toBe(true);
  });
});

describe("getMockBackupBytes", () => {
  it("encodes filename and optional saved marker", () => {
    const [entry] = getMockBackupsForVault("dev-secrets");
    expect(entry).toBeDefined();
    const text = new TextDecoder().decode(getMockBackupBytes(entry!));
    expect(text).toContain(entry!.filename);
    expect(text.startsWith("[Upriv mock backup]\n")).toBe(true);
  });

  it("marks saved backups in the payload", () => {
    const saved = getMockBackupsForVault("dev-secrets").find((b) => b.saved);
    expect(saved).toBeDefined();
    const text = new TextDecoder().decode(getMockBackupBytes(saved!));
    expect(text).toContain("\nsaved\n");
  });
});
