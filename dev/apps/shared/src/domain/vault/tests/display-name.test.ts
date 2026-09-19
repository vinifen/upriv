import { describe, expect, it } from "vitest";
import {
  displayNameFromImportFilename,
  displayNameToVaultId,
  importDisplayNameFromFilename,
  suggestValidDisplayName,
  validateDisplayName,
  liveDisplayNameError,
  vaultDisplayLetters,
} from "..";

describe("displayNameFromImportFilename", () => {
  it("strips .7z extension case-insensitively", () => {
    expect(displayNameFromImportFilename("Notes.7z")).toBe("Notes");
    expect(displayNameFromImportFilename("backup.7Z")).toBe("backup");
    expect(displayNameFromImportFilename("  spaced.7z  ")).toBe("spaced");
  });

  it("strips .zip and .7z extensions", () => {
    expect(displayNameFromImportFilename("Notes.zip")).toBe("Notes");
    expect(displayNameFromImportFilename("Notes.ZIP")).toBe("Notes");
    expect(displayNameFromImportFilename("Notes.7z")).toBe("Notes");
  });

  it("uses the path basename, not the directory", () => {
    expect(displayNameFromImportFilename("/home/user/Downloads/My Notes.zip")).toBe("My Notes");
    expect(displayNameFromImportFilename(String.raw`C:\Users\me\Notes.7z`)).toBe("Notes");
  });

  it("returns empty for a bare extension", () => {
    expect(displayNameFromImportFilename(".7z")).toBe("");
    expect(displayNameFromImportFilename(".zip")).toBe("");
  });
});

describe("suggestValidDisplayName", () => {
  it("keeps a valid name", () => {
    expect(suggestValidDisplayName("My Encrypted Notes")).toBe("My Encrypted Notes");
  });

  it("replaces illegal characters", () => {
    expect(suggestValidDisplayName("Notes: 2026")).toBe("Notes_ 2026");
  });

  it("falls back to vault for reserved names", () => {
    expect(suggestValidDisplayName("CON")).toBe("vault");
  });
});

describe("importDisplayNameFromFilename", () => {
  it("does not flag a valid basename", () => {
    expect(importDisplayNameFromFilename("Notes.zip")).toEqual({
      displayName: "Notes",
      needsChoice: false,
    });
  });

  it("suggests a valid name when the basename is illegal", () => {
    expect(importDisplayNameFromFilename("Notes: 2026.zip")).toEqual({
      displayName: "Notes_ 2026",
      needsChoice: true,
    });
  });
});

describe("validateDisplayName", () => {
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["bad/name", "invalid_chars"],
    ["name?", "invalid_chars"],
    ["trailing.", "trailing"],
    ["CON", "reserved"],
    ["com1", "reserved"],
  ] as const)("rejects %j with %s", (name, code) => {
    expect(validateDisplayName(name)).toBe(code);
  });

  it("accepts valid names", () => {
    expect(validateDisplayName("My Encrypted Notes")).toBeNull();
  });

  it("collapses internal whitespace", () => {
    expect(validateDisplayName("TEST    ASDF")).toBeNull();
    expect(suggestValidDisplayName("Notes:   2026")).toBe("Notes_ 2026");
  });
});

describe("liveDisplayNameError", () => {
  it("skips empty when the field is optional", () => {
    expect(liveDisplayNameError("", { allowEmpty: true })).toBeNull();
    expect(liveDisplayNameError("   ", { allowEmpty: true })).toBeNull();
  });

  it("still flags illegal characters when empty is allowed", () => {
    expect(liveDisplayNameError("asd /23", { allowEmpty: true })).toBe("invalid_chars");
  });

  it("flags empty when the field is required", () => {
    expect(liveDisplayNameError("")).toBe("empty");
  });

  it("allows in-progress spaces; persist collapses them", () => {
    expect(liveDisplayNameError("My ")).toBeNull();
    expect(liveDisplayNameError("My  Vault")).toBeNull();
    expect(liveDisplayNameError("My Vault.")).toBe("trailing");
  });
});

describe("vaultDisplayLetters", () => {
  it("uses the first character of the first two words, always uppercase", () => {
    expect(vaultDisplayLetters("My Encrypted Notes")).toBe("ME");
    expect(vaultDisplayLetters("Vault ExAmple 2")).toBe("VE");
    expect(vaultDisplayLetters("Cold Storage")).toBe("CS");
    expect(vaultDisplayLetters("2FA Secrets")).toBe("2S");
  });

  it("uses a single character when the name is one word", () => {
    expect(vaultDisplayLetters("Notes")).toBe("N");
    expect(vaultDisplayLetters("A")).toBe("A");
    expect(vaultDisplayLetters("  x  ")).toBe("X");
    expect(vaultDisplayLetters("7zip")).toBe("7");
  });

  it("is empty when the name has no words", () => {
    expect(vaultDisplayLetters("")).toBe("");
    expect(vaultDisplayLetters("   ")).toBe("");
  });
});

describe("displayNameToVaultId", () => {
  it("slugifies and deduplicates", () => {
    expect(displayNameToVaultId("My Encrypted Notes", [])).toBe("my-encrypted-notes");
    expect(displayNameToVaultId("My Encrypted Notes", ["my-encrypted-notes"])).toBe(
      "my-encrypted-notes-2",
    );
  });

  it("strips diacritics", () => {
    expect(displayNameToVaultId("São Paulo", [])).toBe("sao-paulo");
  });

  it("falls back to vault when slug is empty", () => {
    expect(displayNameToVaultId("!!!", [])).toBe("vault");
  });

  it("turns ß into a hyphen like NFD (ß does not decompose)", () => {
    expect(displayNameToVaultId("Straße", [])).toBe("stra-e");
  });

  it("does not invent ASCII for letters that NFD does not decompose", () => {
    expect(displayNameToVaultId("Øresund", [])).toBe("resund");
    expect(displayNameToVaultId("Kıbrıs", [])).toBe("k-br-s");
    expect(displayNameToVaultId("Łódź", [])).toBe("odz");
    expect(displayNameToVaultId("Đakovo", [])).toBe("akovo");
    expect(displayNameToVaultId("Ħamrun", [])).toBe("amrun");
    expect(displayNameToVaultId("Nguyễn", [])).toBe("nguyen");
    expect(displayNameToVaultId("Hà Nội", [])).toBe("ha-noi");
    expect(displayNameToVaultId("İstanbul", [])).toBe("istanbul");
    expect(displayNameToVaultId("XŉY", [])).toBe("x-y");
  });

  it("skips Windows reserved slugs", () => {
    expect(displayNameToVaultId("CON", [])).toBe("con-2");
  });
});
