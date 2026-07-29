import { describe, expect, it } from "vitest";
import {
  absolutePathFromDroppedFile,
  dataTransferHasSevenZip,
  firstSevenZipFile,
  isSevenZipFileName,
} from "../vaultArchiveDrop";

describe("isSevenZipFileName", () => {
  it.each([
    ["notes.7z", true],
    ["Notes.7Z", true],
    ["  archive.7z  ", true],
    ["notes.zip", false],
    ["7z", false],
    ["", false],
  ])("%j → %s", (name, expected) => {
    expect(isSevenZipFileName(name)).toBe(expected);
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

describe("firstSevenZipFile", () => {
  it("returns the first .7z in the iterable", () => {
    const files = [new File([], "readme.txt"), new File([], "vault.7z"), new File([], "b.7z")];
    expect(firstSevenZipFile(files)?.name).toBe("vault.7z");
  });

  it("returns null when none match", () => {
    expect(firstSevenZipFile([new File([], "a.zip")])).toBeNull();
  });
});

describe("dataTransferHasSevenZip", () => {
  it("is false for null transfer", () => {
    expect(dataTransferHasSevenZip(null)).toBe(false);
  });

  it("detects .7z among files", () => {
    const transfer = {
      files: [new File([], "a.txt"), new File([], "b.7z")],
    } as unknown as DataTransfer;
    expect(dataTransferHasSevenZip(transfer)).toBe(true);
  });
});
