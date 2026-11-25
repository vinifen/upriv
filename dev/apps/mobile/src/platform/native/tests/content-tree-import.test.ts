import { describe, expect, it } from "vitest";
import {
  JOB_ERROR_CODES,
  RpcError,
  VAULT_ERROR_CODES,
  parseImportBlocked,
  type CreateVaultInput,
  type VaultListItem,
} from "@upriv/shared";
import {
  contentTreeFromFolderPick,
  contentTreeFromPickedFile,
  createContentTreeRegistry,
  importContentTree,
  relativeUnderPickedFolder,
  type ContentTreeImportIo,
} from "../contentTreePlan";

describe("relativeUnderPickedFolder", () => {
  it("strips the picked folder and keeps children", () => {
    expect(relativeUnderPickedFolder("Photos/trip/a.txt", "Photos")).toBe("trip/a.txt");
    expect(relativeUnderPickedFolder("Photos/empty", "Photos")).toBe("empty");
  });

  it("rejects a path that is not inside the picked folder", () => {
    expect(relativeUnderPickedFolder("Other/a.txt", "Photos")).toBeNull();
    expect(relativeUnderPickedFolder("Photos/../secret.txt", "Photos")).toBeNull();
    expect(relativeUnderPickedFolder("Photos", "Photos")).toBeNull();
  });
});

describe("contentTreeFromFolderPick", () => {
  it("places the folder's children at the vault root", () => {
    const tree = contentTreeFromFolderPick({
      folderName: "Photos",
      releaseSafTree: "content://tree/photos",
      directories: ["Photos/empty", "Photos/trip"],
      files: [
        { relativePath: "Photos/trip/a.txt", uri: "content://doc/a" },
        { relativePath: "Photos/note.txt", uri: "content://doc/note" },
      ],
    });
    expect(tree.directoryUri).toBe("content://tree/photos");
    expect(tree.directories).toEqual(["empty", "trip"]);
    expect(tree.files).toEqual([
      { logicalPath: "trip/a.txt", uri: "content://doc/a" },
      { logicalPath: "note.txt", uri: "content://doc/note" },
    ]);
  });

  it("skips the settings folder of an unpacked export at any depth", () => {
    const tree = contentTreeFromFolderPick({
      folderName: "Notes",
      releaseSafTree: "content://tree/notes",
      directories: ["Notes/.upriv-config", "Notes/docs"],
      files: [
        { relativePath: "Notes/.upriv-config/config.toml", uri: "content://doc/config" },
        { relativePath: "Notes/docs/.upriv-config/README.md", uri: "content://doc/readme" },
        { relativePath: "Notes/docs/a.txt", uri: "content://doc/a" },
      ],
    });
    expect(tree.directories).toEqual(["docs"]);
    expect(tree.files).toEqual([{ logicalPath: "docs/a.txt", uri: "content://doc/a" }]);
  });

  it("rejects an entry outside the picked folder", () => {
    expect(() =>
      contentTreeFromFolderPick({
        folderName: "Photos",
        releaseSafTree: "content://tree/photos",
        files: [{ relativePath: "Other/a.txt", uri: "content://doc/a" }],
      }),
    ).toThrow(/outside the chosen folder/);
  });

  it("rejects two files that would land on the same vault path", () => {
    expect(() =>
      contentTreeFromFolderPick({
        folderName: "Photos",
        releaseSafTree: "content://tree/photos",
        files: [
          { relativePath: "Photos/a.txt", uri: "content://doc/a" },
          { relativePath: "Photos/a.txt", uri: "content://doc/b" },
        ],
      }),
    ).toThrow(/same name/);
  });

  it("rejects a file that is also used as a folder", () => {
    expect(() =>
      contentTreeFromFolderPick({
        folderName: "Photos",
        releaseSafTree: "content://tree/photos",
        directories: ["Photos/a/b"],
        files: [{ relativePath: "Photos/a", uri: "content://doc/a" }],
      }),
    ).toThrow(/same name/);
  });

  it("rejects a reserved vault file before a vault is created", () => {
    expect(() =>
      contentTreeFromFolderPick({
        folderName: "Photos",
        releaseSafTree: "content://tree/photos",
        files: [{ relativePath: "Photos/upriv-seed.txt", uri: "content://doc/seed" }],
      }),
    ).toThrow(/reserved/);
  });
});

describe("contentTreeFromPickedFile", () => {
  it("keeps one document at the vault root", () => {
    const tree = contentTreeFromPickedFile({
      path: "/data/user/0/app/cache/DocumentPicker/note.pdf",
      uri: "file:///data/user/0/app/cache/DocumentPicker/note.pdf",
      fileName: "note.pdf",
    });
    expect(tree.directoryUri).toBe("/data/user/0/app/cache/DocumentPicker/note.pdf");
    expect(tree.directories).toEqual([]);
    expect(tree.files).toEqual([
      {
        logicalPath: "note.pdf",
        uri: "file:///data/user/0/app/cache/DocumentPicker/note.pdf",
      },
    ]);
  });

  it("rejects a reserved name before a vault is created", () => {
    expect(() =>
      contentTreeFromPickedFile({
        path: "/data/user/0/app/cache/DocumentPicker/seed.txt",
        uri: "file:///cache/seed.txt",
        fileName: "upriv-seed.txt",
      }),
    ).toThrow(/reserved/);
  });

  it("rejects an empty picker uri", () => {
    expect(() =>
      contentTreeFromPickedFile({ path: "/tmp/note.pdf", uri: "  ", fileName: "note.pdf" }),
    ).toThrow(/unavailable/);
  });
});

describe("importContentTree", () => {
  const JOB = "job-import";
  const input = {
    password: "secret",
    unlockPreset: "256mib",
    settings: { vault: { id: "notes" } },
  } as unknown as CreateVaultInput;
  const tree = contentTreeFromFolderPick({
    folderName: "Photos",
    releaseSafTree: "content://tree/photos",
    directories: ["Photos/empty"],
    files: [{ relativePath: "Photos/a.txt", uri: "content://doc/a" }],
  });

  function io(steps: string[], failAt?: string): ContentTreeImportIo {
    const created = { id: "notes" } as VaultListItem;
    const run = async (name: string) => {
      steps.push(name);
      if (failAt === name) throw new Error(name);
    };
    return {
      createVault: async (createInput, job) => {
        expect(createInput.importPackage).toBeUndefined();
        // One job covers the create and every file, so one Stop ends them all.
        expect(job).toBe(JOB);
        await run("create");
        return created;
      },
      openSession: () => run("open"),
      addDirectory: async (_id, path) => {
        steps.push(`dir:${path}`);
      },
      addFile: async (_id, path, uri, job) => {
        expect(job).toBe(JOB);
        steps.push(`file:${path}:${uri}`);
        if (failAt === "file") throw new Error("file");
      },
      close: (_id, stopped) => run(stopped ? "close:stopped" : "close"),
      abort: () => run("abort"),
    };
  }

  it("creates, streams, and closes without opening a file manager", async () => {
    const steps: string[] = [];
    const created = await importContentTree(input, tree, io(steps), JOB);
    expect(created).toEqual({ vault: { id: "notes" }, leftOut: 0, stopped: false });
    expect(steps).toEqual(["create", "open", "dir:empty", "file:a.txt:content://doc/a", "close"]);
  });

  const twoFiles = contentTreeFromFolderPick({
    folderName: "Photos",
    releaseSafTree: "content://tree/photos",
    files: [
      { relativePath: "Photos/a.txt", uri: "content://doc/a" },
      { relativePath: "Photos/b.txt", uri: "content://doc/b" },
    ],
  });

  /** The person's Stop reaches the import at the file `at`. */
  function stoppedAt(steps: string[], at: string, base = io(steps)): ContentTreeImportIo {
    return {
      ...base,
      addFile: async (_id, path) => {
        steps.push(`file:${path}`);
        if (path === at) throw new RpcError(JOB_ERROR_CODES.CANCELLED, "stopped");
      },
    };
  }

  it("keeps the files that got in when the person stops it", async () => {
    const steps: string[] = [];
    const created = await importContentTree(input, twoFiles, stoppedAt(steps, "b.txt"), JOB);
    expect(created).toEqual({ vault: { id: "notes" }, leftOut: 0, stopped: true });
    expect(steps).toEqual(["create", "open", "file:a.txt", "file:b.txt", "close:stopped"]);
  });

  it("deletes the new vault when the stop comes before any file got in", async () => {
    const steps: string[] = [];
    await expect(
      importContentTree(input, twoFiles, stoppedAt(steps, "a.txt"), JOB),
    ).rejects.toMatchObject({ code: JOB_ERROR_CODES.CANCELLED });
    expect(steps).toEqual(["create", "open", "file:a.txt", "abort"]);
  });

  it("never deletes a stopped import whose close fails", async () => {
    const steps: string[] = [];
    const failingClose: ContentTreeImportIo = {
      ...stoppedAt(steps, "b.txt"),
      close: async () => {
        steps.push("close:stopped");
        throw new Error("disk full");
      },
    };
    await expect(importContentTree(input, twoFiles, failingClose, JOB)).rejects.toThrow(
      "disk full",
    );
    expect(steps).not.toContain("abort");
  });

  it("sends the welcome note unless the picked root already has a README", async () => {
    const welcome = { readme: "# Hi\n", workspace: "{}\n" };
    const sent: (typeof welcome | undefined)[] = [];
    const capture = (base: ContentTreeImportIo): ContentTreeImportIo => ({
      ...base,
      createVault: async (createInput) => {
        sent.push(createInput.welcome);
        return { id: "notes" } as VaultListItem;
      },
    });
    await importContentTree({ ...input, welcome }, tree, capture(io([])), JOB);
    const withReadme = contentTreeFromFolderPick({
      folderName: "Photos",
      releaseSafTree: "content://tree/photos",
      files: [{ relativePath: "Photos/Readme.md", uri: "content://doc/r" }],
    });
    await importContentTree({ ...input, welcome }, withReadme, capture(io([])), JOB);
    const withReadmeDir = contentTreeFromFolderPick({
      folderName: "Photos",
      releaseSafTree: "content://tree/photos",
      directories: ["Photos/README.md"],
      files: [{ relativePath: "Photos/note.txt", uri: "content://doc/n" }],
    });
    await importContentTree({ ...input, welcome }, withReadmeDir, capture(io([])), JOB);
    expect(sent).toEqual([welcome, undefined, undefined]);
  });

  it("deletes the new vault when a file fails and does not close it", async () => {
    const steps: string[] = [];
    await expect(importContentTree(input, tree, io(steps, "file"), JOB)).rejects.toThrow("file");
    expect(steps).toEqual(["create", "open", "dir:empty", "file:a.txt:content://doc/a", "abort"]);
  });

  it("names a document it cannot read and leaves no vault", async () => {
    const steps: string[] = [];
    const unreadable: ContentTreeImportIo = {
      ...io(steps),
      addFile: async (_id, path) => {
        steps.push(`file:${path}`);
        throw new RpcError(VAULT_ERROR_CODES.IMPORT_SOURCE_UNREADABLE, "could not read");
      },
    };
    const error = await importContentTree(input, tree, unreadable, JOB).catch((e: unknown) => e);
    expect(parseImportBlocked(error)).toEqual({
      count: 1,
      items: [{ path: "Photos/a.txt", reason: "unreadable" }],
      whole: false,
    });
    expect(steps).toEqual(["create", "open", "dir:empty", "file:a.txt", "abort"]);

    const file = contentTreeFromPickedFile({
      path: "content://doc/note",
      uri: "content://doc/note",
      fileName: "note.txt",
    });
    const single = await importContentTree(input, file, unreadable, JOB).catch((e: unknown) => e);
    expect(parseImportBlocked(single)).toEqual({
      count: 1,
      items: [{ path: "note.txt", reason: "unreadable" }],
      whole: true,
    });
  });

  it("leaves out a document it cannot read when the person chose that, and counts it", async () => {
    const steps: string[] = [];
    const two = contentTreeFromFolderPick({
      folderName: "Photos",
      releaseSafTree: "content://tree/photos",
      files: [
        { relativePath: "Photos/a.txt", uri: "content://doc/a" },
        { relativePath: "Photos/b.txt", uri: "content://doc/b" },
      ],
    });
    const firstUnreadable: ContentTreeImportIo = {
      ...io(steps),
      addFile: async (_id, path) => {
        steps.push(`file:${path}`);
        if (path === "a.txt") {
          throw new RpcError(VAULT_ERROR_CODES.IMPORT_SOURCE_UNREADABLE, "could not read");
        }
      },
    };
    const leaveOut = {
      ...input,
      importPackage: {
        kind: "os_tree" as const,
        archivePath: "content://tree/photos",
        leaveOut: true,
      },
    };
    const created = await importContentTree(leaveOut, two, firstUnreadable, JOB);
    expect(created.leftOut).toBe(1);
    expect(steps).toEqual(["create", "open", "file:a.txt", "file:b.txt", "close"]);
  });

  it("returns the cleanup error when deleting the failed vault also fails", async () => {
    const steps: string[] = [];
    const base = io(steps, "file");
    const failingAbort: ContentTreeImportIo = {
      ...base,
      abort: async () => {
        steps.push("abort");
        throw new Error("disk full");
      },
    };
    await expect(importContentTree(input, tree, failingAbort, JOB)).rejects.toThrow("disk full");
    expect(steps).toContain("abort");
    expect(steps).not.toContain("close");
  });
});

describe("createContentTreeRegistry", () => {
  const tree = contentTreeFromFolderPick({
    folderName: "Photos",
    releaseSafTree: "content://tree/photos",
    files: [{ relativePath: "Photos/a.txt", uri: "content://doc/a" }],
  });

  it("drops the permission only after the wizard and every job are done", () => {
    const registry = createContentTreeRegistry();
    registry.remember(tree);
    registry.remember({ ...tree, files: [] });
    const first = registry.takeForJob(tree.directoryUri);
    expect(first?.files).toEqual([]);
    const next = { ...tree, files: [{ logicalPath: "b.txt", uri: "content://doc/b" }] };
    registry.remember(next);
    expect(registry.releaseJob(first!)).toBe(false);
    expect(registry.has(tree.directoryUri)).toBe(true);
    const second = registry.takeForJob(tree.directoryUri);
    expect(second?.files).toEqual(next.files);
    expect(registry.releaseJob(second!)).toBe(true);
    expect(registry.has(tree.directoryUri)).toBe(false);
    expect(registry.releaseWizard(tree.directoryUri)).toBe(false);
  });
});
