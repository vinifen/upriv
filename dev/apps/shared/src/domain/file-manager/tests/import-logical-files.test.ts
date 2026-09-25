import { describe, expect, it } from "vitest";
import {
  applyImportedFilesToWorkspace,
  importBatchIsReadFailure,
  importBatchIsWriteFailure,
  importBatchNeedsRetry,
  importLogicalFiles,
} from "../importLogicalFiles";
import type { VaultWorkspaceAction } from "../workspaceReducer";

describe("importLogicalFiles", () => {
  it("imports PDFs and notes through importFile when there is no byte importer", async () => {
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
    expect(result.importedPaths).toEqual(["/doc.pdf", "/note.md"]);
    expect(result.skippedUnsupported).toBe(0);
    expect(imported).toEqual(["//doc.pdf:body:doc.pdf", "//note.md:body:note.md"]);
  });

  it("imports any type through importBinaryFile without reading as text", async () => {
    const read: string[] = [];
    const binary: string[] = [];
    const result = await importLogicalFiles(
      [
        { name: "demo.mkv", relativePath: "demo.mkv" },
        { name: "pack.zip", relativePath: "pack.zip" },
        { name: "pack.7z", relativePath: "pack.7z" },
        { name: "doc.pdf", relativePath: "doc.pdf" },
        { name: "song.mp3", relativePath: "song.mp3" },
        { name: "note.txt", relativePath: "note.txt" },
      ],
      {
        vaultId: "v",
        parentPath: "/",
        readContent: async (file) => {
          read.push(file.name);
          return "nope";
        },
        ensureFolder: () => "/",
        importFile: () => "/should-not",
        importBinaryFile: (_id, parent, name) => {
          binary.push(`${parent}/${name}`);
          return `/${name}`;
        },
      },
    );
    expect(read).toEqual([]);
    expect(binary).toEqual([
      "//demo.mkv",
      "//pack.zip",
      "//pack.7z",
      "//doc.pdf",
      "//song.mp3",
      "//note.txt",
    ]);
    expect(result.importedPaths).toEqual([
      "/demo.mkv",
      "/pack.zip",
      "/pack.7z",
      "/doc.pdf",
      "/song.mp3",
      "/note.txt",
    ]);
    expect(result.skippedUnsupported).toBe(0);
  });

  it("notifies onImported after each stored path", async () => {
    const seen: string[] = [];
    await importLogicalFiles(
      [
        { name: "a.txt", relativePath: "a.txt" },
        { name: "b.txt", relativePath: "nested/b.txt" },
      ],
      {
        vaultId: "v",
        parentPath: "/",
        readContent: async () => "x",
        ensureFolder: () => "/nested",
        importFile: (_id, parent, name) => `${parent === "/" ? "" : parent}/${name}`,
        onImported: (path, relativePath) => {
          seen.push(`${path}:${relativePath}`);
        },
      },
    );
    expect(seen).toEqual(["/a.txt:a.txt", "/nested/b.txt:nested/b.txt"]);
  });

  it("notifies onImportStart before each write, including queued files later in the batch", async () => {
    const events: string[] = [];
    await importLogicalFiles(
      [
        { name: "a.txt", relativePath: "a.txt" },
        { name: "b.txt", relativePath: "b.txt" },
      ],
      {
        vaultId: "v",
        parentPath: "/",
        readContent: async () => "x",
        ensureFolder: () => "/",
        importFile: () => "/should-not",
        importBinaryFile: (_id, _parent, name) => {
          events.push(`write:${name}`);
          return `/${name}`;
        },
        onImportStart: (path) => {
          events.push(`start:${path}`);
        },
      },
    );
    expect(events).toEqual(["start:/a.txt", "write:a.txt", "start:/b.txt", "write:b.txt"]);
  });

  it("stops the batch after a write failure so queued files stay pending", async () => {
    const written: string[] = [];
    const result = await importLogicalFiles(
      [
        { name: "a.txt", relativePath: "a.txt" },
        { name: "b.txt", relativePath: "b.txt" },
        { name: "c.txt", relativePath: "c.txt" },
      ],
      {
        vaultId: "v",
        parentPath: "/",
        readContent: async () => "x",
        ensureFolder: () => "/",
        importFile: (_id, _parent, name) => {
          if (name === "b.txt") throw new Error("write failed");
          written.push(name);
          return `/${name}`;
        },
      },
    );
    expect(written).toEqual(["a.txt"]);
    expect(result.importedPaths).toEqual(["/a.txt"]);
    expect(result.writeFailureName).toBe("b.txt");
    expect(importBatchNeedsRetry(result)).toBe(true);
    expect(importBatchIsWriteFailure(result)).toBe(false);
  });

  it("stops queued files when the abort signal fires after the current write", async () => {
    const abort = new AbortController();
    const written: string[] = [];
    const result = await importLogicalFiles(
      [
        { name: "a.txt", relativePath: "a.txt" },
        { name: "b.txt", relativePath: "b.txt" },
        { name: "c.txt", relativePath: "c.txt" },
      ],
      {
        vaultId: "v",
        parentPath: "/",
        readContent: async () => "x",
        ensureFolder: () => "/",
        importFile: (_id, _parent, name) => {
          written.push(name);
          if (name === "a.txt") abort.abort();
          return `/${name}`;
        },
        signal: abort.signal,
      },
    );
    expect(written).toEqual(["a.txt"]);
    expect(result.importedPaths).toEqual(["/a.txt"]);
    expect(result.writeFailureName).toBeNull();
    expect(importBatchNeedsRetry(result)).toBe(false);
  });

  it("skips the reserved workspace snapshot filename", async () => {
    const imported: string[] = [];
    const result = await importLogicalFiles(
      [{ name: ".upriv-workspace.json", relativePath: ".upriv-workspace.json" }],
      {
        vaultId: "v",
        parentPath: "/",
        readContent: async () => "{}",
        ensureFolder: () => "/",
        importFile: (_id, parent, name, content) => {
          imported.push(`${parent}/${name}:${content}`);
          return `/${name}`;
        },
      },
    );
    expect(result.importedPaths).toEqual([]);
    expect(result.skippedInvalid).toBe(1);
    expect(imported).toEqual([]);
  });

  it("skips a reserved snapshot name nested in a dropped folder", async () => {
    const imported: string[] = [];
    const result = await importLogicalFiles(
      [{ name: "layout.json", relativePath: "pack/.upriv-workspace.json" }],
      {
        vaultId: "v",
        parentPath: "/",
        readContent: async () => "{}",
        ensureFolder: () => "/pack",
        importFile: (_id, parent, name, content) => {
          imported.push(`${parent}/${name}:${content}`);
          return `${parent}/${name}`;
        },
      },
    );
    expect(result.importedPaths).toEqual([]);
    expect(result.skippedInvalid).toBe(1);
    expect(imported).toEqual([]);
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

  it("treats a thrown ensureFolder as import_write_failed and stops the batch", async () => {
    const imported: string[] = [];
    const result = await importLogicalFiles(
      [
        { name: "a.txt", relativePath: "pack/a.txt" },
        { name: "b.txt", relativePath: "pack/b.txt" },
      ],
      {
        vaultId: "v",
        parentPath: "/",
        readContent: async () => "body",
        ensureFolder: async () => {
          throw new Error("timeout");
        },
        importFile: (_id, _parent, name) => {
          imported.push(name);
          return `/${name}`;
        },
      },
    );
    expect(importBatchNeedsRetry(result)).toBe(true);
    expect(result.writeFailureName).toBe("a.txt");
    expect(result.skippedInvalid).toBe(0);
    expect(imported).toEqual([]);
  });

  it("treats a thrown importFile as import_write_failed, not a skip toast", async () => {
    const result = await importLogicalFiles([{ name: "a.txt", relativePath: "a.txt" }], {
      vaultId: "v",
      parentPath: "/",
      readContent: async () => "body",
      ensureFolder: () => "/",
      importFile: async () => {
        throw new Error("write failed");
      },
    });
    expect(importBatchIsWriteFailure(result)).toBe(true);
    expect(result.writeFailureName).toBe("a.txt");
    expect(result.importedPaths).toEqual([]);
  });

  it("does not dispatch workspace actions when nothing imported", async () => {
    const actions: VaultWorkspaceAction[] = [];
    await applyImportedFilesToWorkspace(
      {
        importedPaths: [],
        foldersToExpand: ["/docs"],
        skippedInvalid: 1,
        skippedUnsupported: 0,
        readFailureName: null,
        writeFailureName: null,
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
