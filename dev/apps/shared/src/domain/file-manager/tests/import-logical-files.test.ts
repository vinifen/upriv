import { describe, expect, it } from "vitest";
import {
  applyImportedFilesToWorkspace,
  importBatchIsReadFailure,
  importBatchIsWriteFailure,
  importLogicalFiles,
} from "../importLogicalFiles";
import { importFileSlots } from "../importSlots";
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

  it("stops the batch after a write failure", async () => {
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

  it("keeps two byte imports in flight and returns paths in start order", async () => {
    const names = ["a.txt", "b.txt", "c.txt", "d.txt"];
    let running = 0;
    let maxRunning = 0;
    const release: Array<() => void> = [];
    const pending = importLogicalFiles(
      names.map((name) => ({ name, relativePath: name })),
      {
        vaultId: "v",
        parentPath: "/",
        importSlots: 2,
        readContent: async () => "",
        ensureFolder: () => "/",
        importFile: () => "/no",
        importBinaryFile: (_id, _parent, name) =>
          new Promise((resolve) => {
            running += 1;
            maxRunning = Math.max(maxRunning, running);
            release.push(() => {
              running -= 1;
              resolve(`/${name}`);
            });
          }),
      },
    );
    await waitUntil(() => release.length >= 2);
    expect(release).toHaveLength(2);
    expect(maxRunning).toBe(2);
    release[0]?.();
    release[1]?.();
    await waitUntil(() => release.length >= 4);
    expect(maxRunning).toBe(2);
    release[2]?.();
    release[3]?.();
    const result = await pending;
    expect(result.importedPaths).toEqual(["/a.txt", "/b.txt", "/c.txt", "/d.txt"]);
    expect(result.writeFailureName).toBeNull();
  });

  it("finishes a write already started after a failure and does not start another", async () => {
    const started: string[] = [];
    let releaseFailure: (() => void) | undefined;
    const holdFailure = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    const pending = importLogicalFiles(
      ["a.txt", "b.txt", "c.txt"].map((name) => ({ name, relativePath: name })),
      {
        vaultId: "v",
        parentPath: "/",
        importSlots: 2,
        readContent: async () => "",
        ensureFolder: () => "/",
        importFile: () => "/no",
        importBinaryFile: async (_id, _parent, name) => {
          started.push(name);
          if (name === "a.txt") {
            await holdFailure;
            throw new Error("write failed");
          }
          await delay(40);
          return `/${name}`;
        },
      },
    );
    await waitUntil(() => started.length >= 2);
    releaseFailure?.();
    const result = await pending;
    expect(started).toEqual(["a.txt", "b.txt"]);
    expect(result.writeFailureName).toBe("a.txt");
    expect(result.importedPaths).toEqual(["/b.txt"]);
  });

  it("stops the next byte import when the batch is aborted", async () => {
    const abort = new AbortController();
    const started: string[] = [];
    const result = await importLogicalFiles(
      ["a.txt", "b.txt", "c.txt"].map((name) => ({ name, relativePath: name })),
      {
        vaultId: "v",
        parentPath: "/",
        importSlots: 2,
        signal: abort.signal,
        readContent: async () => "",
        ensureFolder: () => "/",
        importFile: () => "/no",
        importBinaryFile: async (_id, _parent, name) => {
          started.push(name);
          if (name === "a.txt") abort.abort();
          return `/${name}`;
        },
      },
    );
    expect(started).not.toContain("c.txt");
    expect(result.importedPaths).toContain("/a.txt");
    expect(result.writeFailureName).toBeNull();
  });

  it("seals the index once after the batch, not between files", async () => {
    const importOne = async (count: number, sealImports: () => Promise<void>) =>
      importLogicalFiles(
        Array.from({ length: count }, (_, index) => ({
          name: `${index}.bin`,
          relativePath: `${index}.bin`,
        })),
        {
          vaultId: "v",
          parentPath: "/",
          importSlots: 2,
          readContent: async () => "",
          ensureFolder: () => "/",
          importFile: () => "/no",
          importBinaryFile: async (_id, _parent, name) => `/${name}`,
          sealImports,
        },
      );
    const short: string[] = [];
    await importOne(3, async () => {
      short.push("seal");
    });
    expect(short).toEqual(["seal"]);
    const long: string[] = [];
    await importOne(33, async () => {
      long.push("seal");
    });
    expect(long).toEqual(["seal"]);
  });
});

describe("importFileSlots", () => {
  it("leaves cores free and stays at one file on a single core", () => {
    expect(importFileSlots(1, false)).toBe(1);
    expect(importFileSlots(1, true)).toBe(1);
    expect(importFileSlots(2, true)).toBe(1);
    expect(importFileSlots(4, false)).toBe(2);
    expect(importFileSlots(8, false)).toBe(4);
    expect(importFileSlots(16, false)).toBe(4);
    expect(importFileSlots(4, true)).toBe(2);
    expect(importFileSlots(8, true)).toBe(2);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timers = globalThis as {
      setTimeout?: (fn: () => void, ms: number) => void;
    };
    if (!timers.setTimeout) {
      resolve();
      return;
    }
    timers.setTimeout(resolve, ms);
  });
}

function waitUntil(ready: () => boolean): Promise<void> {
  const started = Date.now();
  const poll = async (): Promise<void> => {
    if (ready()) return;
    if (Date.now() - started > 2000) {
      throw new Error("timed out waiting for import slots");
    }
    await delay(1);
    return poll();
  };
  return poll();
}
