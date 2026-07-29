import { describe, expect, it } from "vitest";
import {
  displayNameFromArchiveFilename,
  displayNameToVaultId,
  validateDisplayName,
} from "..";

describe("displayNameFromArchiveFilename", () => {
  it("strips .7z extension case-insensitively", () => {
    expect(displayNameFromArchiveFilename("Notes.7z")).toBe("Notes");
    expect(displayNameFromArchiveFilename("backup.7Z")).toBe("backup");
    expect(displayNameFromArchiveFilename("  spaced.7z  ")).toBe("spaced");
  });

  it("returns empty for bare extension", () => {
    expect(displayNameFromArchiveFilename(".7z")).toBe("");
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
});
