import { afterEach, describe, expect, it, vi } from "vitest";
import type { DragEvent } from "react";
import {
  filesFromDataTransfer,
  filesFromFileInput,
  filesFromOsDropSnapshot,
  listFilesFromOsDropSnapshot,
  isOsFileDrag,
  snapshotLooksLikeOsImport,
  snapshotOsFileDrop,
} from "../osFileDrop";

function dragEvent(partial: Partial<DataTransfer>): DragEvent {
  return { dataTransfer: partial as DataTransfer } as DragEvent;
}

describe("isOsFileDrag", () => {
  it("detects Files type", () => {
    expect(isOsFileDrag(dragEvent({ types: ["Files"] }))).toBe(true);
    expect(isOsFileDrag(dragEvent({ types: ["text/plain"] }))).toBe(false);
  });

  it("detects a FileList on drop even when types is empty", () => {
    const file = new File(["x"], "a.txt");
    expect(isOsFileDrag(dragEvent({ types: [], files: [file] as unknown as FileList }))).toBe(true);
  });

  it("detects DOMStringList-like types", () => {
    const types = {
      length: 1,
      contains: (type: string) => type === "Files",
      item: (index: number) => (index === 0 ? "Files" : null),
    };
    expect(isOsFileDrag(dragEvent({ types: types as unknown as DataTransfer["types"] }))).toBe(
      true,
    );
  });
});

describe("filesFromFileInput", () => {
  it("returns empty for null", () => {
    expect(filesFromFileInput(null)).toEqual([]);
  });

  it("skips empty names and maps relative paths", () => {
    const files = [new File(["a"], "note.md"), new File(["b"], "")] as unknown as FileList;
    Object.defineProperty(files, "length", { value: 2 });
    files[0] = new File(["a"], "note.md");
    files[1] = new File(["b"], "");

    const result = filesFromFileInput(files);
    expect(result).toHaveLength(1);
    expect(result[0]?.relativePath).toBe("note.md");
  });
});

describe("filesFromDataTransfer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns empty when transfer is missing", async () => {
    expect(await filesFromDataTransfer({ dataTransfer: null } as unknown as DragEvent)).toEqual([]);
  });

  it("falls back to transfer.files", async () => {
    const file = new File(["x"], "import.txt");
    const transfer = {
      items: [],
      files: [file],
    } as unknown as DataTransfer;
    const result = await filesFromDataTransfer(dragEvent(transfer));
    expect(result).toEqual([{ file, relativePath: "import.txt" }]);
  });

  it("uses getAsFile when webkit entry is missing", async () => {
    const file = new File(["y"], "from-item.md");
    const item = {
      kind: "file",
      getAsFile: () => file,
    };
    const transfer = {
      items: [item],
      files: [],
    } as unknown as DataTransfer;
    const result = await filesFromDataTransfer(dragEvent(transfer));
    expect(result).toEqual([{ file, relativePath: "from-item.md" }]);
  });

  it("keeps snapshotted files after dataTransfer is cleared", async () => {
    const file = new File(["x"], "import.txt");
    const transfer = {
      types: ["Files"],
      items: [{ kind: "file", getAsFile: () => file }],
      files: [file],
    } as unknown as DataTransfer;
    const snapshot = snapshotOsFileDrop(dragEvent(transfer));
    (transfer as unknown as { items: unknown[] }).items = [];
    (transfer as unknown as { files: File[] }).files = [];
    expect(await filesFromOsDropSnapshot(snapshot)).toEqual([{ file, relativePath: "import.txt" }]);
  });

  it("recovers a basename from getPathForFile when File.name is empty", async () => {
    vi.stubGlobal("window", {
      upriv: { getPathForFile: () => "/tmp/photos/beach.jpg" },
    });
    const file = new File(["img"], "");
    const transfer = {
      items: [],
      files: [file],
    } as unknown as DataTransfer;
    const result = await filesFromDataTransfer(dragEvent(transfer));
    expect(result).toHaveLength(1);
    expect(result[0]?.file.name).toBe("beach.jpg");
    expect(result[0]?.relativePath).toBe("beach.jpg");
  });

  it("collects file: URIs when FileList is empty", () => {
    const transfer = {
      items: [],
      files: [],
      getData: (type: string) => (type === "text/uri-list" ? "file:///tmp/hello.txt" : ""),
    } as unknown as DataTransfer;
    const snapshot = snapshotOsFileDrop(dragEvent(transfer));
    expect(snapshot.osPaths).toEqual(["/tmp/hello.txt"]);
    expect(snapshotLooksLikeOsImport(snapshot)).toBe(true);
  });

  it("collects Windows and macOS file: URIs", () => {
    const windows = {
      items: [],
      files: [],
      getData: (type: string) =>
        type === "text/uri-list" ? "file:///C:/Users/vini/a.txt\r\n" : "",
    } as unknown as DataTransfer;
    expect(snapshotOsFileDrop(dragEvent(windows)).osPaths).toEqual(["C:/Users/vini/a.txt"]);

    const mac = {
      items: [],
      files: [],
      getData: (type: string) =>
        type === "text/uri-list" ? "file:///Users/vini/My%20File.txt" : "",
    } as unknown as DataTransfer;
    expect(snapshotOsFileDrop(dragEvent(mac)).osPaths).toEqual(["/Users/vini/My File.txt"]);
  });

  it("reads uri-list paths through readDroppedPaths", async () => {
    vi.stubGlobal("window", {
      upriv: {
        readDroppedPaths: async () => [{ relativePath: "hello.txt", contentB64: btoa("hi") }],
      },
    });
    const transfer = {
      items: [],
      files: [],
      getData: (type: string) => (type === "text/uri-list" ? "file:///tmp/hello.txt" : ""),
    } as unknown as DataTransfer;
    const files = await filesFromOsDropSnapshot(snapshotOsFileDrop(dragEvent(transfer)));
    expect(files).toHaveLength(1);
    expect(files[0]?.relativePath).toBe("hello.txt");
    await expect(files[0]?.file.text()).resolves.toBe("hi");
  });

  it("keeps large videos as a stream handle instead of loading them into a File", async () => {
    vi.stubGlobal("window", {
      upriv: {
        statDroppedPaths: async () => [
          { relativePath: "demo.mkv", osPath: "/tmp/demo.mkv", size: 80 * 1024 * 1024 },
        ],
        readDroppedPathRange: async () => {
          throw new Error("should stream later, not now");
        },
        readDroppedPaths: async () => {
          throw new Error("should not fully read a video");
        },
      },
    });
    const transfer = {
      items: [],
      files: [],
      getData: (type: string) => (type === "text/uri-list" ? "file:///tmp/demo.mkv" : ""),
    } as unknown as DataTransfer;
    const files = await filesFromOsDropSnapshot(snapshotOsFileDrop(dragEvent(transfer)));
    expect(files).toHaveLength(1);
    expect(files[0]?.relativePath).toBe("demo.mkv");
    expect(files[0]?.osPath).toBe("/tmp/demo.mkv");
    expect(files[0]?.byteSize).toBe(80 * 1024 * 1024);
    expect(files[0]?.file.size).toBe(0);
  });

  it("streams oversized text the same way as oversized video", async () => {
    vi.stubGlobal("window", {
      upriv: {
        statDroppedPaths: async () => [
          { relativePath: "huge.txt", osPath: "/tmp/huge.txt", size: 80 * 1024 * 1024 },
        ],
        readDroppedPathRange: async () => {
          throw new Error("should stream later, not now");
        },
        readDroppedPaths: async () => {
          throw new Error("should not fully read an oversized text file");
        },
      },
    });
    const transfer = {
      items: [],
      files: [],
      getData: (type: string) => (type === "text/uri-list" ? "file:///tmp/huge.txt" : ""),
    } as unknown as DataTransfer;
    const files = await filesFromOsDropSnapshot(snapshotOsFileDrop(dragEvent(transfer)));
    expect(files[0]?.relativePath).toBe("huge.txt");
    expect(files[0]?.osPath).toBe("/tmp/huge.txt");
    expect(files[0]?.byteSize).toBe(80 * 1024 * 1024);
  });

  it("keeps small uri-list files as OS path handles instead of loading bytes", async () => {
    vi.stubGlobal("window", {
      upriv: {
        statDroppedPaths: async () => [
          { relativePath: "hello.txt", osPath: "/tmp/hello.txt", size: 2 },
        ],
        readDroppedPathRange: async () => {
          throw new Error("should stream in the daemon, not in the renderer");
        },
        readDroppedPaths: async () => {
          throw new Error("should not fully read a listed OS path");
        },
      },
    });
    const transfer = {
      items: [],
      files: [],
      getData: (type: string) => (type === "text/uri-list" ? "file:///tmp/hello.txt" : ""),
    } as unknown as DataTransfer;
    const files = await filesFromOsDropSnapshot(snapshotOsFileDrop(dragEvent(transfer)));
    expect(files[0]?.osPath).toBe("/tmp/hello.txt");
    expect(files[0]?.file.size).toBe(0);
  });

  it("walks a folder even when the dropped File reports a non-zero size", async () => {
    vi.stubGlobal("window", {
      upriv: {
        getPathForFile: () => "/tmp/photos",
        statDroppedPaths: async () => [
          { relativePath: "photos/a.txt", osPath: "/tmp/photos/a.txt", size: 4 },
          { relativePath: "photos/b.txt", osPath: "/tmp/photos/b.txt", size: 5 },
        ],
      },
    });
    const folder = new File(["not-a-directory"], "photos");
    const transfer = {
      items: [],
      files: [folder],
      getData: () => "",
    } as unknown as DataTransfer;
    const files = await filesFromOsDropSnapshot(snapshotOsFileDrop(dragEvent(transfer)));
    expect(files.map((file) => file.relativePath)).toEqual(["photos/a.txt", "photos/b.txt"]);
  });

  it("resolves an XDG portal transfer key through retrievePortalDrop", async () => {
    vi.stubGlobal("window", {
      upriv: {
        retrievePortalDrop: async () => ["/tmp/portal-note.txt"],
        statDroppedPaths: async () => [
          { relativePath: "portal-note.txt", osPath: "/tmp/portal-note.txt", size: 3 },
        ],
      },
    });
    const transfer = {
      items: [],
      files: [],
      getData: (type: string) =>
        type === "application/vnd.portal.filetransfer" ? "portal-key-1" : "",
    } as unknown as DataTransfer;
    const snapshot = snapshotOsFileDrop(dragEvent(transfer));
    expect(snapshot.portalKey).toBe("portal-key-1");
    expect(snapshotLooksLikeOsImport(snapshot)).toBe(true);
    const files = await filesFromOsDropSnapshot(snapshot);
    expect(files[0]?.osPath).toBe("/tmp/portal-note.txt");
  });

  it("reads Nautilus gnome-copied-files URIs", () => {
    const transfer = {
      items: [],
      files: [],
      getData: (type: string) =>
        type === "x-special/gnome-copied-files" ? "copy\nfile:///tmp/note.txt\n" : "",
    } as unknown as DataTransfer;
    const snapshot = snapshotOsFileDrop(dragEvent(transfer));
    expect(snapshot.osPaths).toEqual(["/tmp/note.txt"]);
  });

  it("does not walk a file that already sits inside a dropped folder", async () => {
    const seen: string[][] = [];
    vi.stubGlobal("window", {
      upriv: {
        getPathForFile: (file: File) =>
          file.name === "photos" ? "/tmp/photos" : "/tmp/photos/a.txt",
        statDroppedPaths: async (paths: string[]) => {
          seen.push(paths);
          return [{ relativePath: "photos/a.txt", osPath: "/tmp/photos/a.txt", size: 4 }];
        },
      },
    });
    const folder = new File(["dir"], "photos");
    const child = new File(["a"], "a.txt");
    const transfer = {
      items: [],
      files: [folder, child],
      getData: () => "",
    } as unknown as DataTransfer;
    await filesFromOsDropSnapshot(snapshotOsFileDrop(dragEvent(transfer)));
    expect(seen[0]).toEqual(["/tmp/photos"]);
  });

  it("treats Windows drive paths as the same folder when only the drive letter case differs", async () => {
    const seen: string[][] = [];
    vi.stubGlobal("window", {
      upriv: {
        getPathForFile: (file: File) => (file.name === "Photos" ? "C:\\Photos" : "c:/photos/a.txt"),
        statDroppedPaths: async (paths: string[]) => {
          seen.push(paths);
          return [{ relativePath: "Photos/a.txt", osPath: "C:\\Photos\\a.txt", size: 4 }];
        },
      },
    });
    const folder = new File(["dir"], "Photos");
    const child = new File(["a"], "a.txt");
    const transfer = {
      items: [],
      files: [folder, child],
      getData: () => "",
    } as unknown as DataTransfer;
    await filesFromOsDropSnapshot(snapshotOsFileDrop(dragEvent(transfer)));
    expect(seen[0]).toEqual(["C:/Photos"]);
  });

  it("does not import a directory placeholder when the walk finds no files", async () => {
    vi.stubGlobal("window", {
      upriv: {
        getPathForFile: () => "/tmp/empty-dir",
        statDroppedPaths: async () => [],
      },
    });
    const folder = new File(["dir"], "empty-dir");
    const transfer = {
      items: [],
      files: [folder],
      getData: () => "",
    } as unknown as DataTransfer;
    const files = await filesFromOsDropSnapshot(snapshotOsFileDrop(dragEvent(transfer)));
    expect(files).toEqual([]);
  });

  it("keeps Linux paths distinct when only letter case differs", async () => {
    const seen: string[][] = [];
    vi.stubGlobal("window", {
      upriv: {
        getPathForFile: (file: File) =>
          file.name === "Photos" ? "/tmp/Photos" : "/tmp/photos/a.txt",
        statDroppedPaths: async (paths: string[]) => {
          seen.push(paths);
          return [];
        },
      },
    });
    const folder = new File(["dir"], "Photos");
    const child = new File(["a"], "a.txt");
    const transfer = {
      items: [],
      files: [folder, child],
      getData: () => "",
    } as unknown as DataTransfer;
    await filesFromOsDropSnapshot(snapshotOsFileDrop(dragEvent(transfer)));
    expect(seen[0]).toEqual(["/tmp/Photos", "/tmp/photos/a.txt"]);
  });

  it("reports a truncated OS listing without dropping the files that were listed", async () => {
    vi.stubGlobal("window", {
      upriv: {
        statDroppedPaths: async () => ({
          files: [{ relativePath: "a.txt", osPath: "/tmp/a.txt", size: 1 }],
          unreadable: [],
          truncated: true,
        }),
      },
    });
    const transfer = {
      items: [],
      files: [],
      getData: (type: string) => (type === "text/uri-list" ? "file:///tmp/a.txt" : ""),
    } as unknown as DataTransfer;
    const listed = await listFilesFromOsDropSnapshot(snapshotOsFileDrop(dragEvent(transfer)));
    expect(listed.truncated).toBe(true);
    expect(listed.files.map((file) => file.relativePath)).toEqual(["a.txt"]);
  });

  it("keeps the browser file when the OS path cannot be read", async () => {
    vi.stubGlobal("window", {
      upriv: {
        getPathForFile: () => "/tmp/secret.txt",
        statDroppedPaths: async () => ({ files: [], unreadable: ["/tmp/secret.txt"] }),
      },
    });
    const file = new File(["hello"], "secret.txt");
    const transfer = {
      items: [],
      files: [file],
      getData: () => "",
    } as unknown as DataTransfer;
    const files = await filesFromOsDropSnapshot(snapshotOsFileDrop(dragEvent(transfer)));
    expect(files).toHaveLength(1);
    expect(files[0]?.osPath).toBeUndefined();
    expect(files[0]?.file.size).toBe(5);
    expect(await files[0]?.file.text()).toBe("hello");
  });
});
