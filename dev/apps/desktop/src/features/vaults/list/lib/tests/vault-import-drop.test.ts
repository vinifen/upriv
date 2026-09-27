import { afterEach, describe, expect, it, vi } from "vitest";
import {
  snapshotOsFileDrop,
  type FileDropEvent,
} from "@/features/vaults/file-manager/lib/osFileDrop";
import { vaultListDropSource } from "../vaultImportDrop";

function dropEvent(partial: Partial<DataTransfer>): FileDropEvent {
  return {
    preventDefault() {},
    stopPropagation() {},
    dataTransfer: partial as DataTransfer,
  };
}

function transfer(
  partial: Partial<DataTransfer> & { getData?: (type: string) => string },
): DataTransfer {
  return {
    items: [],
    files: [],
    getData: () => "",
    ...partial,
  } as unknown as DataTransfer;
}

describe("vaultListDropSource", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when the drop has no file", async () => {
    const source = await vaultListDropSource(
      snapshotOsFileDrop({
        preventDefault() {},
        stopPropagation() {},
        dataTransfer: null,
      }),
    );
    expect(source).toBeNull();
  });

  it("uses the absolute path of a plain file", async () => {
    vi.stubGlobal("window", {
      upriv: {
        getPathForFile: () => "/tmp/notes.txt",
        classifyDroppedPath: async () => "file",
      },
    });
    const source = await vaultListDropSource(
      snapshotOsFileDrop(
        dropEvent(
          transfer({
            files: [new File([], "notes.txt")] as unknown as FileList,
          }),
        ),
        { pathsOnly: true },
      ),
    );
    expect(source).toEqual({
      fileName: "notes.txt",
      absolutePath: "/tmp/notes.txt",
      shape: "file",
    });
  });

  it("keeps a folder and drops a child that sits inside it", async () => {
    const seen: string[] = [];
    vi.stubGlobal("window", {
      upriv: {
        getPathForFile: (file: File) =>
          file.name === "Photos" ? "/tmp/Photos" : "/tmp/Photos/a.txt",
        classifyDroppedPath: async (osPath: string) => {
          seen.push(osPath);
          return osPath === "/tmp/Photos" ? "directory" : "file";
        },
      },
    });
    const source = await vaultListDropSource(
      snapshotOsFileDrop(
        dropEvent(
          transfer({
            files: [new File([], "Photos"), new File([], "a.txt")] as unknown as FileList,
          }),
        ),
        { pathsOnly: true },
      ),
    );
    expect(source).toEqual({
      fileName: "Photos",
      absolutePath: "/tmp/Photos",
      shape: "directory",
    });
    expect(seen).toEqual(["/tmp/Photos"]);
  });

  it("reads a file URI when the drop has no File object", async () => {
    vi.stubGlobal("window", {
      upriv: {
        classifyDroppedPath: async () => "file",
      },
    });
    const source = await vaultListDropSource(
      snapshotOsFileDrop(
        dropEvent(
          transfer({
            getData: (type: string) => (type === "text/uri-list" ? "file:///tmp/notes.txt" : ""),
          }),
        ),
        { pathsOnly: true },
      ),
    );
    expect(source).toEqual({
      fileName: "notes.txt",
      absolutePath: "/tmp/notes.txt",
      shape: "file",
    });
  });

  it("resolves an XDG portal key to a folder", async () => {
    vi.stubGlobal("window", {
      upriv: {
        retrievePortalDrop: async () => ["/tmp/Photos"],
        classifyDroppedPath: async () => "directory",
      },
    });
    const source = await vaultListDropSource(
      snapshotOsFileDrop(
        dropEvent(
          transfer({
            getData: (type: string) =>
              type === "application/vnd.portal.filetransfer" ? "portal-key" : "",
          }),
        ),
        { pathsOnly: true },
      ),
    );
    expect(source).toEqual({
      fileName: "Photos",
      absolutePath: "/tmp/Photos",
      shape: "directory",
    });
  });

  it("uses the first root when two files are dropped", async () => {
    vi.stubGlobal("window", {
      upriv: {
        getPathForFile: (file: File) => (file.name === "a.txt" ? "/tmp/a.txt" : "/tmp/b.txt"),
        classifyDroppedPath: async () => "file",
      },
    });
    const source = await vaultListDropSource(
      snapshotOsFileDrop(
        dropEvent(
          transfer({
            files: [new File([], "a.txt"), new File([], "b.txt")] as unknown as FileList,
          }),
        ),
        { pathsOnly: true },
      ),
    );
    expect(source?.absolutePath).toBe("/tmp/a.txt");
    expect(source?.fileName).toBe("a.txt");
  });

  it("keeps a file name when the shell has no path", async () => {
    const source = await vaultListDropSource(
      snapshotOsFileDrop(
        dropEvent(
          transfer({
            files: [new File([], "notes.txt")] as unknown as FileList,
          }),
        ),
        { pathsOnly: true },
      ),
    );
    expect(source).toEqual({ fileName: "notes.txt", shape: "file" });
  });

  it("treats a symlink classification as a file so create can refuse it", async () => {
    vi.stubGlobal("window", {
      upriv: {
        getPathForFile: () => "/tmp/link",
        classifyDroppedPath: async () => "other",
      },
    });
    const source = await vaultListDropSource(
      snapshotOsFileDrop(
        dropEvent(
          transfer({
            files: [new File([], "link")] as unknown as FileList,
          }),
        ),
        { pathsOnly: true },
      ),
    );
    expect(source?.shape).toBe("file");
    expect(source?.absolutePath).toBe("/tmp/link");
  });

  it("stays a file when classification fails", async () => {
    vi.stubGlobal("window", {
      upriv: {
        getPathForFile: () => "/tmp/Photos",
        classifyDroppedPath: async () => {
          throw new Error("ipc down");
        },
      },
    });
    const source = await vaultListDropSource(
      snapshotOsFileDrop(
        dropEvent(
          transfer({
            files: [new File([], "Photos")] as unknown as FileList,
          }),
        ),
        { pathsOnly: true },
      ),
    );
    expect(source?.shape).toBe("file");
    expect(source?.absolutePath).toBe("/tmp/Photos");
  });
});
