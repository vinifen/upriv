import { describe, expect, it } from "vitest";
import type { CreateVaultInput, VaultListItem } from "@upriv/shared";
import {
  contentTreeFromFolderPick,
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

describe("importContentTree", () => {
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
      createVault: async (createInput) => {
        expect(createInput.importPackage).toBeUndefined();
        await run("create");
        return created;
      },
      openSession: () => run("open"),
      addDirectory: async (_id, path) => {
        steps.push(`dir:${path}`);
      },
      addFile: async (_id, path, uri) => {
        steps.push(`file:${path}:${uri}`);
        if (failAt === "file") throw new Error("file");
      },
      close: () => run("close"),
      abort: () => run("abort"),
    };
  }

  it("creates, streams, and closes without opening a file manager", async () => {
    const steps: string[] = [];
    const created = await importContentTree(input, tree, io(steps));
    expect(created.id).toBe("notes");
    expect(steps).toEqual(["create", "open", "dir:empty", "file:a.txt:content://doc/a", "close"]);
  });

  it("deletes the new vault when a file fails and does not close it", async () => {
    const steps: string[] = [];
    await expect(importContentTree(input, tree, io(steps, "file"))).rejects.toThrow("file");
    expect(steps).toEqual(["create", "open", "dir:empty", "file:a.txt:content://doc/a", "abort"]);
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
    await expect(importContentTree(input, tree, failingAbort)).rejects.toThrow("disk full");
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
