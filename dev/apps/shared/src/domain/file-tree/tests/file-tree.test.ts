import { describe, expect, it } from "vitest";
import { normalizeStoredName } from "../../format/storedName";
import {
  LOGICAL_FILE_NAME_MAX_LENGTH,
  liveFileNameError,
  persistLogicalFileName,
  sanitizeLogicalFileName,
  acceptedLogicalFileName,
  validateFileName,
} from "../fileNameValidation";
import { fileNameErrorI18nKey } from "../errorMessages";
import {
  vaultFileLanguageFromPath,
  isVaultImportUnsupported,
  imageDataUrlFromBase64,
} from "../language";
import {
  foldersToExpandOnImport,
  importPathSegments,
  resolveImportDestination,
} from "../importPaths";
import {
  TREE_SPLIT_MIN_PERCENT,
  clampCanonicalTreeSplitPercent,
  persistableTreeSplitPercent,
  displayTreeSplitPercent,
  percentFromPointer,
  percentFromDelta,
} from "../treeSplit";

describe("validateFileName", () => {
  it("rejects empty, dot, and illegal names", () => {
    expect(validateFileName("  ")).toBe("empty");
    expect(validateFileName(".")).toBe("empty");
    expect(validateFileName("..")).toBe("empty");
    expect(validateFileName("a/b")).toBe("invalid_chars");
    expect(validateFileName("Notes: 2026")).toBe("invalid_chars");
  });

  it("accepts a normal file name", () => {
    expect(validateFileName("notes.md")).toBeNull();
  });

  it("keeps internal spaces, including doubles; trailing space is stripped", () => {
    expect(validateFileName("My Notes")).toBeNull();
    expect(validateFileName("My Notes.md")).toBeNull();
    expect(validateFileName("draft ")).toBeNull();
    expect(validateFileName("report    final.md")).toBeNull();
  });

  it("accepts punctuation and scripts that every target OS can store", () => {
    expect(validateFileName("São Paulo.md")).toBeNull();
    expect(validateFileName("it's ok.txt")).toBeNull();
    expect(validateFileName("report (final) [v2].md")).toBeNull();
    expect(validateFileName(".env")).toBeNull();
    expect(validateFileName("mês-1_ok+notes.md")).toBeNull();
  });

  it("flags reserved Windows stems and over-long names", () => {
    expect(validateFileName("CON.txt")).toBe("reserved");
    expect(validateFileName("nul")).toBe("reserved");
    expect(validateFileName("a".repeat(LOGICAL_FILE_NAME_MAX_LENGTH))).toBeNull();
    expect(validateFileName("a".repeat(LOGICAL_FILE_NAME_MAX_LENGTH + 1))).toBe("too_long");
  });
});

describe("persistLogicalFileName", () => {
  it("does not collapse internal spaces", () => {
    expect(persistLogicalFileName("report    final.md")).toBe("report    final.md");
  });

  it("does not trim leading spaces or rewrite case / unicode (unlike vault titles)", () => {
    expect(persistLogicalFileName("  TEST    ASDF  ")).toBe("  TEST    ASDF");
    expect(normalizeStoredName("  TEST    ASDF  ")).toBe("TEST ASDF");
    expect(persistLogicalFileName("São  Paulo")).toBe("São  Paulo");
    expect(persistLogicalFileName("README.MD")).toBe("README.MD");
  });

  it("strips trailing spaces and dots for Windows", () => {
    expect(persistLogicalFileName("notes.md.")).toBe("notes.md");
    expect(persistLogicalFileName("draft  ")).toBe("draft");
    expect(persistLogicalFileName("folder...")).toBe("folder");
  });
});

describe("acceptedLogicalFileName", () => {
  it("returns the persisted name when the OS can store it", () => {
    expect(acceptedLogicalFileName("My  Notes.md")).toBe("My  Notes.md");
    expect(acceptedLogicalFileName("draft  ")).toBe("draft");
  });

  it("rejects names that would split or escape a path component", () => {
    expect(acceptedLogicalFileName("a/b.md")).toBeNull();
    expect(acceptedLogicalFileName("a\\b.md")).toBeNull();
    expect(acceptedLogicalFileName("Notes: 2026")).toBeNull();
    expect(acceptedLogicalFileName("CON.txt")).toBeNull();
    expect(acceptedLogicalFileName("..")).toBeNull();
  });
});

describe("liveFileNameError", () => {
  it("does not flag trailing space or dot because persist will strip them", () => {
    expect(liveFileNameError("draft ")).toBeNull();
    expect(liveFileNameError("notes.md.")).toBeNull();
  });

  it("still blocks characters the OS cannot store", () => {
    expect(liveFileNameError("Notes: 2026")).toBe("invalid_chars");
    expect(liveFileNameError("CON.txt")).toBe("reserved");
  });
});

describe("sanitizeLogicalFileName", () => {
  it("keeps a valid original name", () => {
    expect(sanitizeLogicalFileName("My  Notes.md")).toBe("My  Notes.md");
  });

  it.each([
    "My  Notes.md",
    "café.txt",
    "日本語.md",
    "🎉.png",
    "it's ok.md",
    "report (final).md",
    "a,b;c.md",
    ".env",
    "README",
  ])("does not rewrite %s", (name) => {
    expect(sanitizeLogicalFileName(name)).toBe(name);
  });

  it.each([
    ["Notes: 2026.md", "Notes_ 2026.md"],
    ["file?.md", "file_.md"],
    ["file|.md", "file_.md"],
    ['say "hi".txt', "say _hi_.txt"],
    ["a<b>c.txt", "a_b_c.txt"],
    ["a\\b.txt", "a_b.txt"],
    ["a/b.txt", "a_b.txt"],
    ["star*.md", "star_.md"],
    ["tab\there.md", "tab_here.md"],
  ])("replaces only OS-forbidden characters in %s", (raw, expected) => {
    expect(sanitizeLogicalFileName(raw)).toBe(expected);
  });

  it("rewrites reserved Windows stems, keeping the original case", () => {
    expect(sanitizeLogicalFileName("CON.txt")).toBe("CON_.txt");
    expect(sanitizeLogicalFileName("con.txt")).toBe("con_.txt");
    expect(sanitizeLogicalFileName("NUL")).toBe("NUL_");
    expect(sanitizeLogicalFileName("COM1.md")).toBe("COM1_.md");
    expect(sanitizeLogicalFileName("AUX.")).toBe("AUX_");
  });

  it("does not treat CON_ as reserved after a forbidden-char rewrite", () => {
    expect(sanitizeLogicalFileName("CON:.txt")).toBe("CON_.txt");
  });

  it("truncates to 255 characters and keeps a short extension", () => {
    const tooLong = `${"n".repeat(300)}.md`;
    const next = sanitizeLogicalFileName(tooLong);
    expect(next.length).toBe(LOGICAL_FILE_NAME_MAX_LENGTH);
    expect(next.endsWith(".md")).toBe(true);
    expect(next).toBe(`${"n".repeat(LOGICAL_FILE_NAME_MAX_LENGTH - 3)}.md`);
  });

  it("falls back when the name is only dots", () => {
    expect(sanitizeLogicalFileName("..")).toBe("file");
    expect(sanitizeLogicalFileName("..", "folder")).toBe("folder");
    expect(sanitizeLogicalFileName("...")).toBe("file");
    expect(sanitizeLogicalFileName("   ", "folder")).toBe("folder");
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

  it("marks PDF as unsupported import and images as supported", () => {
    expect(isVaultImportUnsupported("doc.pdf")).toBe(true);
    expect(isVaultImportUnsupported("pic.png")).toBe(false);
    expect(imageDataUrlFromBase64("AAAA", "pic.png")).toBe("data:image/png;base64,AAAA");
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

  it("sanitizes OS-illegal segments instead of skipping the file", () => {
    const created: string[] = [];
    const result = resolveImportDestination(
      "v",
      "/",
      "Notes: 2026/file?.md",
      (_id, parent, name) => {
        created.push(name);
        return parent === "/" ? `/${name}` : `${parent}/${name}`;
      },
    );
    expect(result).toEqual({ parentPath: "/Notes_ 2026", fileName: "file_.md" });
    expect(created).toEqual(["Notes_ 2026"]);
  });

  it("rewrites .. so import cannot walk out of the vault", () => {
    const result = resolveImportDestination("v", "/", "../x.md", (_id, parent, name) => {
      return parent === "/" ? `/${name}` : `${parent}/${name}`;
    });
    expect(result).toEqual({ parentPath: "/folder", fileName: "x.md" });
  });

  it("keeps double spaces in every segment when nothing is illegal", () => {
    const created: string[] = [];
    const result = resolveImportDestination(
      "v",
      "/",
      "Viagem  2026/fotos  raw/ok  file.md",
      (_id, parent, name) => {
        created.push(name);
        return parent === "/" ? `/${name}` : `${parent}/${name}`;
      },
    );
    expect(result).toEqual({
      parentPath: "/Viagem  2026/fotos  raw",
      fileName: "ok  file.md",
    });
    expect(created).toEqual(["Viagem  2026", "fotos  raw"]);
  });

  it("treats Windows backslashes as folder separators", () => {
    const created: string[] = [];
    const result = resolveImportDestination(
      "v",
      "/",
      "docs\\Notes: 2026\\a.md",
      (_id, parent, name) => {
        created.push(name);
        return parent === "/" ? `/${name}` : `${parent}/${name}`;
      },
    );
    expect(result).toEqual({ parentPath: "/docs/Notes_ 2026", fileName: "a.md" });
    expect(created).toEqual(["docs", "Notes_ 2026"]);
  });
});

describe("foldersToExpandOnImport", () => {
  it("includes each ancestor of a nested relative path", () => {
    expect(foldersToExpandOnImport("/", "a/b/c.md")).toEqual(["/", "/a", "/a/b"]);
    expect(foldersToExpandOnImport("/", "a.md")).toEqual(["/"]);
    expect(foldersToExpandOnImport("/", "a   b/c.md")).toEqual(["/", "/a   b"]);
  });

  it("uses sanitized folder segments so the UI expands the stored path", () => {
    expect(foldersToExpandOnImport("/", "Notes: 2026/a.md")).toEqual(["/", "/Notes_ 2026"]);
    expect(importPathSegments("docs\\a.md")).toEqual(["docs", "a.md"]);
    expect(foldersToExpandOnImport("/", "docs\\sub\\a.md")).toEqual(["/", "/docs", "/docs/sub"]);
  });
});

describe("tree split canonical ↔ visual mapping", () => {
  it("stores canonical min when the pointer hits the row px floor", () => {
    // visual min on 800px width = 18%; pointer at that edge → canonical 15
    expect(percentFromPointer((800 * 18) / 100, 0, 800, "x")).toBe(TREE_SPLIT_MIN_PERCENT);
  });

  it("maps canonical min to visual min on both axes (no leftover on column)", () => {
    expect(displayTreeSplitPercent(TREE_SPLIT_MIN_PERCENT, 800, "x")).toBe(18);
    expect(displayTreeSplitPercent(TREE_SPLIT_MIN_PERCENT, 500, "y")).toBe(TREE_SPLIT_MIN_PERCENT);
  });

  it("keeps mid-range proportion across axes", () => {
    // canonical 40 is halfway-ish: t = (40-15)/50 = 0.5
    expect(displayTreeSplitPercent(40, 800, "x")).toBe(18 + 0.5 * (65 - 18));
    expect(displayTreeSplitPercent(40, 500, "y")).toBe(15 + 0.5 * (65 - 15));
  });

  it("clamps canonical storage to 15–65", () => {
    expect(clampCanonicalTreeSplitPercent(0)).toBe(TREE_SPLIT_MIN_PERCENT);
    expect(clampCanonicalTreeSplitPercent(90)).toBe(65);
  });

  it("rounds a live drag percent into canonical storage", () => {
    expect(persistableTreeSplitPercent(40.4)).toBe(40);
    expect(persistableTreeSplitPercent(40.6)).toBe(41);
    expect(persistableTreeSplitPercent(0)).toBe(TREE_SPLIT_MIN_PERCENT);
  });

  it("maps a mid pointer through canonical storage", () => {
    expect(percentFromPointer(200, 0, 1000, "x")).toBe(20);
    expect(percentFromPointer(75, 0, 500, "y")).toBe(TREE_SPLIT_MIN_PERCENT);
  });

  it("keeps the split still when the drag delta is 0", () => {
    expect(percentFromDelta(20, 0, 1000, "x")).toBe(20);
    expect(percentFromDelta(40, 0, 800, "x")).toBe(40);
    expect(percentFromDelta(TREE_SPLIT_MIN_PERCENT, 0, 500, "y")).toBe(TREE_SPLIT_MIN_PERCENT);
  });

  it("moves the split by the pointer delta without snapping to the pointer", () => {
    const start = 20;
    const size = 1000;
    expect(percentFromDelta(start, 50, size, "x")).toBe(25);
    expect(percentFromDelta(start, -50, size, "x")).toBe(15);
  });
});
