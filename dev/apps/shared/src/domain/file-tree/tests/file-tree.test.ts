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
import { vaultFileLanguageFromPath, imageDataUrlFromBase64 } from "../language";
import {
  foldersToExpandForImportBatch,
  foldersToExpandOnImport,
  importPathSegments,
  resolveImportDestination,
} from "../importPaths";
import {
  TREE_SPLIT_MIN_PERCENT,
  clampCanonicalTreeSplitPercent,
  persistableTreeSplitPercent,
  displayTreeSplitPercent,
  percentFromDelta,
  treeSplitCollapseThresholdPx,
  isTreeSplitDragCollapsed,
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
    ["/clip.mp4", "binary"],
    ["/song.mp3", "binary"],
    ["/pack.zip", "binary"],
    ["/data.bin", "binary"],
  ] as const)("%s → %s", (path, language) => {
    expect(vaultFileLanguageFromPath(path)).toBe(language);
  });

  it("keeps the editor language binary for opaque files", () => {
    expect(vaultFileLanguageFromPath("doc.pdf")).toBe("binary");
    expect(vaultFileLanguageFromPath("clip.mkv")).toBe("binary");
    expect(vaultFileLanguageFromPath("note.txt")).not.toBe("binary");
    expect(imageDataUrlFromBase64("AAAA", "pic.png")).toBe("data:image/png;base64,AAAA");
  });

  it("treats video MIME as binary even without an extension", () => {
    expect(vaultFileLanguageFromPath("clip", "video/x-matroska")).toBe("binary");
  });
});

describe("resolveImportDestination", () => {
  it("creates nested folders then returns the file leaf", async () => {
    const created: string[] = [];
    const result = await resolveImportDestination(
      "vault-1",
      "/",
      "docs/a.md",
      (_id, parent, name) => {
        created.push(`${parent}/${name}`);
        return parent === "/" ? `/${name}` : `${parent}/${name}`;
      },
    );
    expect(result).toEqual({ parentPath: "/docs", fileName: "a.md" });
    expect(created).toEqual(["//docs"]);
  });

  it("sanitizes OS-illegal segments instead of skipping the file", async () => {
    const created: string[] = [];
    const result = await resolveImportDestination(
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

  it("rewrites .. so import cannot walk out of the vault", async () => {
    const result = await resolveImportDestination("v", "/", "../x.md", (_id, parent, name) => {
      return parent === "/" ? `/${name}` : `${parent}/${name}`;
    });
    expect(result).toEqual({ parentPath: "/folder", fileName: "x.md" });
  });

  it("keeps double spaces in every segment when nothing is illegal", async () => {
    const created: string[] = [];
    const result = await resolveImportDestination(
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

  it("treats Windows backslashes as folder separators", async () => {
    const created: string[] = [];
    const result = await resolveImportDestination(
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

describe("foldersToExpandForImportBatch", () => {
  it("opens each folder once", () => {
    expect(foldersToExpandForImportBatch("/", ["a/b/c.md", "a/d.md", "e.md"])).toEqual([
      "/",
      "/a",
      "/a/b",
    ]);
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
  it("stores canonical min when the drag hits the row px floor", () => {
    // visual min on 800px width = 8% (64px); dragging past that edge → canonical 4
    expect(percentFromDelta(20, -150, 800, "x")).toBe(TREE_SPLIT_MIN_PERCENT);
  });

  it("maps canonical min to visual min on both axes (no leftover on column)", () => {
    expect(displayTreeSplitPercent(TREE_SPLIT_MIN_PERCENT, 800, "x")).toBe(8);
    expect(displayTreeSplitPercent(TREE_SPLIT_MIN_PERCENT, 500, "y")).toBe(TREE_SPLIT_MIN_PERCENT);
  });

  it("keeps mid-range proportion across axes", () => {
    // canonical 40: span = 65 - 4 = 61; t = (40 - 4) / 61 = 36 / 61
    expect(displayTreeSplitPercent(40, 800, "x")).toBe(8 + (36 / 61) * (65 - 8));
    expect(displayTreeSplitPercent(40, 500, "y")).toBe(40);
  });

  it("holds the row px floor when it exceeds the max split", () => {
    // 64px of an 80px row = 80%: every canonical % shows the floor and a drag stores the min.
    expect(displayTreeSplitPercent(40, 80, "x")).toBe(80);
    expect(percentFromDelta(40, 30, 80, "x")).toBe(TREE_SPLIT_MIN_PERCENT);
  });

  it("clamps canonical storage to 4–65", () => {
    expect(clampCanonicalTreeSplitPercent(0)).toBe(TREE_SPLIT_MIN_PERCENT);
    expect(clampCanonicalTreeSplitPercent(90)).toBe(65);
  });

  it("rounds a live drag percent into canonical storage", () => {
    expect(persistableTreeSplitPercent(40.4)).toBe(40);
    expect(persistableTreeSplitPercent(40.6)).toBe(41);
    expect(persistableTreeSplitPercent(0)).toBe(TREE_SPLIT_MIN_PERCENT);
  });

  it("keeps the split still when the drag delta is 0", () => {
    expect(percentFromDelta(20, 0, 1600, "x")).toBe(20);
    expect(percentFromDelta(40, 0, 800, "x")).toBe(40);
    expect(percentFromDelta(TREE_SPLIT_MIN_PERCENT, 0, 500, "y")).toBe(TREE_SPLIT_MIN_PERCENT);
  });

  it("moves the split by the pointer delta without snapping to the pointer", () => {
    const start = 20;
    const size = 1600;
    expect(percentFromDelta(start, 80, size, "x")).toBe(25);
    expect(percentFromDelta(start, -80, size, "x")).toBe(15);
  });

  it("computes collapse threshold at 50% of visual minimum", () => {
    // 1600px width: visual min = 4% = 64px -> threshold = 32px
    expect(treeSplitCollapseThresholdPx(1600, "x")).toBe(32);
    // 800px width: visual min = 8% = 64px -> threshold = 32px
    expect(treeSplitCollapseThresholdPx(800, "x")).toBe(32);
    // 500px height: visual min = 4% = 20px -> threshold = 10px
    expect(treeSplitCollapseThresholdPx(500, "y")).toBe(10);
    expect(treeSplitCollapseThresholdPx(0, "x")).toBe(0);
  });

  it("identifies when dragging moves past the collapse threshold", () => {
    // start at 20% on 1600px (320px). threshold is 32px.
    // drag -200px -> 120px (> 32px): not collapsed
    expect(isTreeSplitDragCollapsed(20, -200, 1600, "x")).toBe(false);
    // drag -260px -> 60px (in detent zone below min 64px, above threshold 32px): not collapsed
    expect(isTreeSplitDragCollapsed(20, -260, 1600, "x")).toBe(false);
    // drag -288px -> 32px (at threshold): collapsed
    expect(isTreeSplitDragCollapsed(20, -288, 1600, "x")).toBe(true);
    // drag -300px -> 20px (past threshold towards 0): collapsed
    expect(isTreeSplitDragCollapsed(20, -300, 1600, "x")).toBe(true);
  });
});
