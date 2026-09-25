import { describe, expect, it } from "vitest";
import type { FileTreeNode } from "../types";
import {
  IMPORT_WALK_SLOT_COUNT,
  attachImportedPath,
  dropResolvedPending,
  dropSessionPending,
  isImportWalkPlaceholderPath,
  mergePendingIntoTree,
  pendingEntriesForExplorer,
  pendingEntriesFromRelativePaths,
  plannedImportPath,
  replaceSessionPending,
  walkPlaceholderEntries,
  upsertActiveImportWrite,
  dropActiveImportWritesForSession,
  dropActiveImportWritePath,
  activeImportWriteForPath,
  filesStillPendingImport,
  rememberLandedImportPaths,
  isPendingImportTimedOut,
} from "../pendingImport";

const emptyRoot: FileTreeNode = { name: "", type: "folder", children: [] };

describe("rememberLandedImportPaths", () => {
  it("keeps the same set when every path is already recorded", () => {
    const landed = new Set(["/a.txt"]);
    expect(rememberLandedImportPaths(landed, ["/a.txt"])).toBe(landed);
  });

  it("adds a path that just finished storing", () => {
    expect([...rememberLandedImportPaths(new Set(["/a.txt"]), ["/b.txt"])]).toEqual([
      "/a.txt",
      "/b.txt",
    ]);
  });
});

describe("pendingEntriesFromRelativePaths", () => {
  it("builds folder and file paths under the drop parent", () => {
    const pending = pendingEntriesFromRelativePaths("/", ["other/a.png", "other/b.txt"], 1);
    expect(pending).toEqual([
      { path: "/other", type: "folder", sessionId: 1 },
      { path: "/other/a.png", type: "file", sessionId: 1 },
      { path: "/other/b.txt", type: "file", sessionId: 1 },
    ]);
    expect(plannedImportPath("/", "other/a.png")).toBe("/other/a.png");
  });

  it("plans a unique file name and does not mark an existing file pending", () => {
    const live: FileTreeNode = {
      name: "",
      type: "folder",
      children: [{ name: "notes.txt", type: "file" }],
    };
    const pending = pendingEntriesFromRelativePaths("/", ["notes.txt", "notes.txt"], 1, live);
    expect(pending.map((entry) => entry.path)).toEqual(["/notes-2.txt", "/notes-3.txt"]);
    expect(pending.some((entry) => entry.path === "/notes.txt")).toBe(false);
  });
});

describe("mergePendingIntoTree", () => {
  it("inserts missing skeleton nodes without dropping live files", () => {
    const live: FileTreeNode = {
      name: "",
      type: "folder",
      children: [{ name: "notes.md", type: "file" }],
    };
    const merged = mergePendingIntoTree(
      live,
      pendingEntriesFromRelativePaths("/", ["pack/doc.pdf"], 1),
    );
    expect(merged.children?.map((child) => child.name)).toEqual(["notes.md", "pack"]);
    expect(merged.children?.[1]?.children?.map((child) => child.name)).toEqual(["doc.pdf"]);
  });

  it("attaches an imported file so the skeleton can drop away", () => {
    const withFile = attachImportedPath(emptyRoot, "/readme.txt");
    expect(withFile.children).toEqual([{ name: "readme.txt", type: "file" }]);
  });
});

describe("walk placeholders", () => {
  it("lists a few unnamed slots under the drop folder", () => {
    const slots = walkPlaceholderEntries("/inbox", 7);
    expect(slots).toHaveLength(IMPORT_WALK_SLOT_COUNT);
    expect(slots.every((slot) => isImportWalkPlaceholderPath(slot.path))).toBe(true);
    expect(slots[0]?.path).toBe("/inbox/.upriv-import-walk-7-0");
  });
});

describe("dropResolvedPending", () => {
  it("removes the imported file and keeps the folder while a sibling is still pending", () => {
    const pending = pendingEntriesFromRelativePaths("/", ["other/a.png", "other/b.txt"], 1);
    const next = dropResolvedPending(pending, "/other/a.png", "/other/a.png", 1);
    expect(next).toEqual([
      { path: "/other", type: "folder", sessionId: 1 },
      { path: "/other/b.txt", type: "file", sessionId: 1 },
    ]);
    expect(dropResolvedPending(next, "/other/b.txt", "/other/b.txt", 1)).toEqual([]);
  });

  it("leaves another session's skeletons in place", () => {
    const first = pendingEntriesFromRelativePaths("/", ["a.zip"], 1);
    const second = pendingEntriesFromRelativePaths("/", ["b.txt"], 2);
    const next = dropResolvedPending([...first, ...second], "/a.zip", "/a.zip", 1);
    expect(next).toEqual([{ path: "/b.txt", type: "file", sessionId: 2 }]);
  });
});

describe("replaceSessionPending", () => {
  it("swaps one session without clearing another", () => {
    const walks = walkPlaceholderEntries("/", 1);
    const named = pendingEntriesFromRelativePaths("/", ["pack.zip"], 1);
    const other = pendingEntriesFromRelativePaths("/", ["notes.md"], 2);
    const next = replaceSessionPending([...walks, ...other], 1, named);
    expect(next.some((entry) => isImportWalkPlaceholderPath(entry.path))).toBe(false);
    expect(next.map((entry) => entry.path).sort()).toEqual(["/notes.md", "/pack.zip"]);
  });

  it("dropSessionPending removes only that batch", () => {
    const a = pendingEntriesFromRelativePaths("/", ["a.zip"], 1);
    const b = pendingEntriesFromRelativePaths("/", ["b.txt"], 2);
    expect(dropSessionPending([...a, ...b], 1)).toEqual(b);
  });
});

describe("active import writes", () => {
  it("tracks one in-flight write per session and looks up by path", () => {
    const first = upsertActiveImportWrite([], {
      sessionId: 1,
      path: "/a.zip",
      startedAt: 10,
    });
    const queuedSibling = upsertActiveImportWrite(first, {
      sessionId: 1,
      path: "/b.txt",
      startedAt: 20,
    });
    expect(activeImportWriteForPath(queuedSibling, "/a.zip")).toBeUndefined();
    expect(activeImportWriteForPath(queuedSibling, "/b.txt")?.startedAt).toBe(20);

    const overlapping = upsertActiveImportWrite(queuedSibling, {
      sessionId: 2,
      path: "/c.md",
      startedAt: 30,
    });
    expect(activeImportWriteForPath(overlapping, "/b.txt")?.sessionId).toBe(1);
    expect(activeImportWriteForPath(overlapping, "/c.md")?.sessionId).toBe(2);
    expect(dropActiveImportWritesForSession(overlapping, 1).map((write) => write.path)).toEqual([
      "/c.md",
    ]);
    expect(dropActiveImportWritePath(overlapping, "/b.txt", 1).map((write) => write.path)).toEqual([
      "/c.md",
    ]);
    expect(dropActiveImportWritePath(overlapping, "/b.txt", 2).map((write) => write.path)).toEqual([
      "/b.txt",
      "/c.md",
    ]);
  });

  it("retry lists only files whose skeletons are still pending", () => {
    const files = [{ relativePath: "a.txt" }, { relativePath: "b.txt" }, { relativePath: "c.txt" }];
    const pending = pendingEntriesFromRelativePaths("/", ["b.txt", "c.txt"], 1);
    expect(filesStillPendingImport(files, "/", pending).map((file) => file.relativePath)).toEqual([
      "b.txt",
      "c.txt",
    ]);
    expect(
      filesStillPendingImport(files, "/", pendingEntriesFromRelativePaths("/", ["z.md"], 1)),
    ).toEqual([]);
    expect(
      filesStillPendingImport(files, "/", walkPlaceholderEntries("/", 1)).map(
        (file) => file.relativePath,
      ),
    ).toEqual(["a.txt", "b.txt", "c.txt"]);
  });

  it("draws every queued file until the explorer skeleton limit", () => {
    const pending = pendingEntriesFromRelativePaths("/", ["a.txt", "b.txt"], 1);
    expect(pendingEntriesForExplorer(pending, new Set()).map((entry) => entry.path)).toEqual([
      "/a.txt",
      "/b.txt",
    ]);
  });

  it("draws folders and only the file being written once the queue is large", () => {
    const relative = Array.from({ length: 201 }, (_, index) => `photos/f${index}.txt`);
    const pending = pendingEntriesFromRelativePaths("/", relative, 1);
    const shown = pendingEntriesForExplorer(pending, new Set(["/photos/f0.txt"]));
    expect(shown.filter((entry) => entry.type === "folder").map((entry) => entry.path)).toEqual([
      "/photos",
    ]);
    expect(shown.filter((entry) => entry.type === "file").map((entry) => entry.path)).toEqual([
      "/photos/f0.txt",
      "/photos/.upriv-import-queue",
    ]);
    const idle = pendingEntriesForExplorer(pending, new Set());
    expect(idle.filter((entry) => entry.type === "file").map((entry) => entry.path)).toEqual([
      "/photos/.upriv-import-queue",
    ]);
    const landed = new Set(["/photos/f0.txt", "/photos/f1.txt"]);
    const kept = pendingEntriesForExplorer(pending, new Set(["/photos/f2.txt"]), landed);
    expect(kept.filter((entry) => entry.type === "folder").map((entry) => entry.path)).toEqual([
      "/photos",
    ]);
    expect(kept.filter((entry) => entry.type === "file").map((entry) => entry.path)).toEqual([
      "/photos/f0.txt",
      "/photos/f1.txt",
      "/photos/f2.txt",
      "/photos/.upriv-import-queue",
    ]);
  });

  it("times out only the in-flight write while the session is still running", () => {
    const pending = pendingEntriesFromRelativePaths("/", ["a.zip", "b.txt"], 1);
    const processing = new Set(["/a.zip"]);
    expect(isPendingImportTimedOut("/a.zip", pending, [1], [1], processing)).toBe(true);
    expect(isPendingImportTimedOut("/b.txt", pending, [1], [1], processing)).toBe(false);
    expect(isPendingImportTimedOut("/b.txt", pending, [1], [], processing)).toBe(true);
  });
});
