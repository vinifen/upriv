import { describe, expect, it } from "vitest";
import {
  applyImportedFilesToWorkspace,
  importBatchIsReadFailure,
  importLogicalFiles,
} from "../importLogicalFiles";
import type { VaultWorkspaceAction } from "../workspaceReducer";

describe("importLogicalFiles", () => {
  it("skips PDFs without calling importFile", async () => {
    const imported: string[] = [];
    const result = await importLogicalFiles(
      [
        { name: "doc.pdf", relativePath: "doc.pdf" },
        { name: "note.md", relativePath: "note.md" },
      ],
      {
        vaultId: "v",
        parentPath: "/",
        readContent: async (file) => `body:${file.name}`,
        ensureFolder: () => "/",
        importFile: (_id, parent, name, content) => {
          imported.push(`${parent}/${name}:${content}`);
          return `/${name}`;
        },
      },
    );
    expect(result.importedPaths).toEqual(["/note.md"]);
    expect(result.skippedUnsupported).toBe(1);
    expect(imported).toEqual(["//note.md:body:note.md"]);
  });

  it("counts a thrown unsupported read as skip, not import_failed", async () => {
    const result = await importLogicalFiles([{ name: "x.bin", relativePath: "x.bin" }], {
      vaultId: "v",
      parentPath: "/",
      readContent: async () => {
        throw new Error("unsupported");
      },
      ensureFolder: () => "/",
      importFile: () => "/x.bin",
    });
    expect(result.importedPaths).toEqual([]);
    expect(result.skippedUnsupported).toBe(1);
    expect(result.readFailureName).toBeNull();
  });

  it("treats a lone I/O failure as import_failed, not a skip toast", async () => {
    const result = await importLogicalFiles([{ name: "a.txt", relativePath: "a.txt" }], {
      vaultId: "v",
      parentPath: "/",
      readContent: async () => {
        throw new Error("read failed");
      },
      ensureFolder: () => "/",
      importFile: () => "/a.txt",
    });
    expect(importBatchIsReadFailure(result)).toBe(true);
    expect(result.readFailureName).toBe("a.txt");
  });

  it("does not dispatch workspace actions when nothing imported", () => {
    const actions: VaultWorkspaceAction[] = [];
    applyImportedFilesToWorkspace(
      {
        importedPaths: [],
        foldersToExpand: ["/docs"],
        skippedInvalid: 1,
        skippedUnsupported: 0,
        readFailureName: null,
      },
      (action) => {
        actions.push(action);
      },
      () => {
        actions.push({ type: "tree_mutated", revision: 1 });
      },
    );
    expect(actions).toEqual([]);
  });
});
