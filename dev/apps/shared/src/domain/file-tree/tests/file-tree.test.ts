import { describe, expect, it } from "vitest";
import { validateFileName } from "../fileNameValidation";
import { fileNameErrorI18nKey } from "../errorMessages";
import { vaultFileLanguageFromPath } from "../language";
import { foldersToExpandOnImport, resolveImportDestination } from "../importPaths";
import { TREE_SPLIT_MIN_PERCENT, clampTreeSplitPercent, percentFromPointer } from "../treeSplit";

describe("validateFileName", () => {
  it("rejects empty, dot, and illegal names", () => {
    expect(validateFileName("  ")).toBe("empty");
    expect(validateFileName(".")).toBe("invalid_chars");
    expect(validateFileName("..")).toBe("invalid_chars");
    expect(validateFileName("a/b")).toBe("invalid_chars");
  });

  it("accepts a normal file name", () => {
    expect(validateFileName("notes.md")).toBeNull();
  });
});

describe("fileNameErrorI18nKey", () => {
  it("maps duplicate to the vault name key", () => {
    expect(fileNameErrorI18nKey("duplicate")).toBe("vault.name.duplicate");
  });
});

describe("vaultFileLanguageFromPath", () => {
  it.each([
    ["/doc.pdf", "binary"],
    ["/pic.PNG", "image"],
    ["/readme.md", "markdown"],
    ["/run.sh", "shell"],
    ["/.env", "env"],
    ["/app.env.local", "env"],
    ["/notes.txt", "text"],
  ] as const)("%s → %s", (path, language) => {
    expect(vaultFileLanguageFromPath(path)).toBe(language);
  });
});

describe("resolveImportDestination", () => {
  it("creates nested folders then returns the file leaf", () => {
    const created: string[] = [];
    const result = resolveImportDestination("vault-1", "/", "docs/a.md", (_id, parent, name) => {
      created.push(`${parent}/${name}`);
      return parent === "/" ? `/${name}` : `${parent}/${name}`;
    });
    expect(result).toEqual({ parentPath: "/docs", fileName: "a.md" });
    expect(created).toEqual(["//docs"]);
  });

  it("rejects illegal folder or file segments", () => {
    expect(resolveImportDestination("v", "/", "../x.md", () => "/")).toBeNull();
    expect(resolveImportDestination("v", "/", "ok/..", () => "/ok")).toBeNull();
  });
});

describe("foldersToExpandOnImport", () => {
  it("includes each ancestor of a nested relative path", () => {
    expect(foldersToExpandOnImport("/", "a/b/c.md")).toEqual(["/", "/a", "/a/b"]);
    expect(foldersToExpandOnImport("/", "a.md")).toEqual(["/"]);
  });
});

describe("clampTreeSplitPercent", () => {
  it("honors the 144px floor on a wide container", () => {
    expect(clampTreeSplitPercent(0, 1000)).toBe(TREE_SPLIT_MIN_PERCENT);
    expect(clampTreeSplitPercent(90, 1000)).toBe(65);
  });

  it("maps pointer position through the same clamp", () => {
    expect(percentFromPointer(200, 0, 1000)).toBe(20);
  });
});
