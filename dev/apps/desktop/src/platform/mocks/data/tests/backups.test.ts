import { describe, expect, it } from "vitest";
import { getMockBackupBytes, getMockBackupsForVault } from "../backups";

describe("getMockBackupsForVault", () => {
  it("returns empty for unknown vault", () => {
    expect(getMockBackupsForVault("no-such-vault")).toEqual([]);
  });

  it("sorts by createdAt descending", () => {
    const list = getMockBackupsForVault("my-encrypted-notes");
    expect(list.map((b) => b.stamp)).toEqual([
      "20260528T120000",
      "20260515T090000",
      "20260401T100000",
    ]);
    expect(list[2]?.saved).toBe(true);
  });
});

describe("getMockBackupBytes", () => {
  it("encodes stamp and optional saved marker", () => {
    const [entry] = getMockBackupsForVault("dev-secrets");
    expect(entry).toBeDefined();
    const text = new TextDecoder().decode(getMockBackupBytes(entry!));
    expect(text).toContain(entry!.stamp);
    expect(text.startsWith("[Upriv mock backup]\n")).toBe(true);
  });

  it("marks saved backups in the payload", () => {
    const saved = getMockBackupsForVault("dev-secrets").find((b) => b.saved);
    expect(saved).toBeDefined();
    const text = new TextDecoder().decode(getMockBackupBytes(saved!));
    expect(text).toContain("\nsaved\n");
  });
});
