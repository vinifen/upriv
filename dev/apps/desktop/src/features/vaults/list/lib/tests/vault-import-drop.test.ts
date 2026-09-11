import { describe, expect, it } from "vitest";
import {
  absolutePathFromDroppedFile,
  dataTransferHasVaultImport,
  firstVaultImportFile,
  isVaultImportFileName,
} from "../vaultImportDrop";

describe("isVaultImportFileName", () => {
  it.each([
    ["notes.7z", true],
    ["Notes.7Z", true],
    ["  archive.7z  ", true],
    ["notes.zip", true],
    ["Notes.upriv.zip", true],
    ["7z", false],
    ["notes.txt", false],
    ["", false],
  ])("%j → %s", (name, expected) => {
    expect(isVaultImportFileName(name)).toBe(expected);
  });
});

describe("absolutePathFromDroppedFile", () => {
  it("reads Electron path when present", () => {
    const file = Object.assign(new File([], "a.7z"), { path: "/tmp/vaults/a.7z" });
    expect(absolutePathFromDroppedFile(file)).toBe("/tmp/vaults/a.7z");
  });

  it("returns undefined when path is missing or blank", () => {
    expect(absolutePathFromDroppedFile(new File([], "a.7z"))).toBeUndefined();
    const blank = Object.assign(new File([], "a.7z"), { path: "  " });
    expect(absolutePathFromDroppedFile(blank)).toBeUndefined();
  });
});

describe("firstVaultImportFile", () => {
  it("returns the first .zip or .7z in the iterable", () => {
    const files = [new File([], "readme.txt"), new File([], "vault.zip"), new File([], "b.7z")];
    expect(firstVaultImportFile(files)?.name).toBe("vault.zip");
  });

  it("returns null when none match", () => {
    expect(firstVaultImportFile([new File([], "a.txt")])).toBeNull();
  });
});

describe("dataTransferHasVaultImport", () => {
  it("is false for null transfer", () => {
    expect(dataTransferHasVaultImport(null)).toBe(false);
  });

  it("detects .zip among files", () => {
    const transfer = {
      files: [new File([], "a.txt"), new File([], "b.zip")],
    } as unknown as DataTransfer;
    expect(dataTransferHasVaultImport(transfer)).toBe(true);
  });
});
