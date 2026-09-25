import { beforeEach, describe, expect, it } from "vitest";
import { findNode } from "../treeUtils";
import { foldersToExpandOnImport, resolveImportDestination } from "../importPaths";
import {
  createVaultFile,
  createVaultFolder,
  ensureVaultFolder,
  getVaultFileContent,
  getVaultFileTree,
  importVaultFile,
  renameVaultPath,
  resetVaultFileSession,
} from "../../../testing/fileSystem";

const VAULT = "folder-import-policy";

function importRelativeTree(
  files: readonly { relativePath: string; content: string }[],
  baseParent = "/",
): Promise<{ paths: string[]; skipped: number }> {
  return (async () => {
    const paths: string[] = [];
    let skipped = 0;
    for (const file of files) {
      const destination = await resolveImportDestination(
        VAULT,
        baseParent,
        file.relativePath,
        ensureVaultFolder,
      );
      if (!destination) {
        skipped += 1;
        continue;
      }
      const path = importVaultFile(
        VAULT,
        destination.parentPath,
        destination.fileName,
        file.content,
      );
      if (!path) {
        skipped += 1;
        continue;
      }
      paths.push(path);
    }
    return { paths, skipped };
  })();
}

describe("folder import name policy", () => {
  beforeEach(() => {
    resetVaultFileSession(VAULT);
  });

  it("keeps original folder and file names when they are already universal", async () => {
    const { paths, skipped } = await importRelativeTree([
      { relativePath: "Viagem  2026/fotos/praia.jpg", content: "img-a" },
      { relativePath: "Viagem  2026/fotos/mar.jpg", content: "img-b" },
      { relativePath: "Viagem  2026/ok.md", content: "ok" },
    ]);

    expect(skipped).toBe(0);
    expect(paths).toEqual([
      "/Viagem  2026/fotos/praia.jpg",
      "/Viagem  2026/fotos/mar.jpg",
      "/Viagem  2026/ok.md",
    ]);
    expect(findNode(getVaultFileTree(VAULT), "/Viagem  2026")?.type).toBe("folder");
    expect(getVaultFileContent(VAULT, "/Viagem  2026/ok.md")?.content).toBe("ok");
  });

  it("rewrites only OS-illegal segments and reuses the sanitized folder", async () => {
    const { paths, skipped } = await importRelativeTree([
      { relativePath: "Notes: 2026/dia 1.md", content: "one" },
      { relativePath: "Notes: 2026/dia 2.md", content: "two" },
      { relativePath: "Notes| 2026/extra.md", content: "three" },
    ]);

    expect(skipped).toBe(0);
    expect(paths).toEqual([
      "/Notes_ 2026/dia 1.md",
      "/Notes_ 2026/dia 2.md",
      "/Notes_ 2026/extra.md",
    ]);
    expect(findNode(getVaultFileTree(VAULT), "/Notes: 2026")).toBeNull();
    expect(findNode(getVaultFileTree(VAULT), "/Notes| 2026")).toBeNull();
    expect(findNode(getVaultFileTree(VAULT), "/Notes_ 2026")?.children?.map((c) => c.name)).toEqual(
      ["dia 1.md", "dia 2.md", "extra.md"],
    );
  });

  it("keeps unicode, punctuation that every OS allows, and leading-dot names", async () => {
    const { paths, skipped } = await importRelativeTree([
      { relativePath: "São Paulo/mês 1.txt", content: "a" },
      { relativePath: "São Paulo/it's ok.md", content: "b" },
      { relativePath: "São Paulo/.env", content: "c" },
      { relativePath: "São Paulo/report (final).md", content: "d" },
    ]);

    expect(skipped).toBe(0);
    expect(paths).toEqual([
      "/São Paulo/mês 1.txt",
      "/São Paulo/it's ok.md",
      "/São Paulo/.env",
      "/São Paulo/report (final).md",
    ]);
  });

  it("rewrites reserved Windows files and suffixes collisions after sanitizing", async () => {
    const { paths, skipped } = await importRelativeTree([
      { relativePath: "pack/CON.txt", content: "con" },
      { relativePath: "pack/file?.md", content: "q" },
      { relativePath: "pack/file|.md", content: "p" },
    ]);

    expect(skipped).toBe(0);
    expect(paths).toEqual(["/pack/CON_.txt", "/pack/file_.md", "/pack/file_-2.md"]);
    expect(getVaultFileContent(VAULT, "/pack/file_.md")?.content).toBe("q");
    expect(getVaultFileContent(VAULT, "/pack/file_-2.md")?.content).toBe("p");
  });

  it("does not create empty folders that were never listed as file ancestors", async () => {
    await importRelativeTree([{ relativePath: "keep/a.md", content: "x" }]);
    expect(findNode(getVaultFileTree(VAULT), "/keep")).not.toBeNull();
    expect(findNode(getVaultFileTree(VAULT), "/empty")).toBeNull();
  });

  it("skips the reserved workspace snapshot name", async () => {
    const { paths, skipped } = await importRelativeTree([
      { relativePath: ".upriv-workspace.json", content: "{}" },
      { relativePath: "readme.md", content: "hi" },
    ]);
    expect(skipped).toBe(1);
    expect(paths).toEqual(["/readme.md"]);
    expect(findNode(getVaultFileTree(VAULT), "/.upriv-workspace.json")).toBeNull();
  });

  it("expands ancestors using sanitized folder names", () => {
    expect(foldersToExpandOnImport("/", "Notes: 2026/a.md")).toEqual(["/", "/Notes_ 2026"]);
    expect(foldersToExpandOnImport("/", "Viagem  2026/fotos/a.jpg")).toEqual([
      "/",
      "/Viagem  2026",
      "/Viagem  2026/fotos",
    ]);
  });

  it("rebuilds a Windows backslash tree instead of flattening it into one name", async () => {
    const { paths, skipped } = await importRelativeTree([
      { relativePath: "Viagem  2026\\fotos\\praia.jpg", content: "img" },
    ]);
    expect(skipped).toBe(0);
    expect(paths).toEqual(["/Viagem  2026/fotos/praia.jpg"]);
  });

  it("refuses slash names so joinPath cannot invent extra segments", () => {
    expect(createVaultFile(VAULT, "/", "a/b.md")).toBeNull();
    expect(createVaultFolder(VAULT, "/", "a\\b")).toBeNull();
    expect(ensureVaultFolder(VAULT, "/", "Notes: x")).toBeNull();
    expect(importVaultFile(VAULT, "/", "file?.md", "x")).toBeNull();
    const path = createVaultFile(VAULT, "/", "ok.md");
    expect(renameVaultPath(VAULT, path!, "bad:name.md")).toBeNull();
    expect(findNode(getVaultFileTree(VAULT), "/ok.md")?.type).toBe("file");
  });

  it("keeps double spaces when creating a file", () => {
    expect(createVaultFile(VAULT, "/", "My  Notes.md")).toBe("/My  Notes.md");
  });
});
