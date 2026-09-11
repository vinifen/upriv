import { describe, expect, it } from "vitest";
import {
  addChild,
  collectFilePaths,
  getParentPath,
  isDescendantPath,
  moveNode,
  remapContentPaths,
  removeContentPaths,
  removeNode,
  renameNode,
  uniqueFolderName,
  uniqueName,
} from "../treeOps";
import { fileBaseName, findNode, isFolderPath, joinPath } from "../treeUtils";
import type { FileTreeNode } from "../types";

function rootWithNotes(): FileTreeNode {
  return {
    name: "",
    type: "folder",
    children: [
      {
        name: "notes",
        type: "folder",
        children: [{ name: "a.md", type: "file" }],
      },
      { name: "readme.md", type: "file" },
    ],
  };
}

describe("tree path helpers", () => {
  it("joins, splits, and finds nodes", () => {
    const root = rootWithNotes();
    expect(joinPath("/", "notes")).toBe("/notes");
    expect(joinPath("/notes", "a.md")).toBe("/notes/a.md");
    expect(getParentPath("/notes/a.md")).toBe("/notes");
    expect(getParentPath("/")).toBe("/");
    expect(fileBaseName("/notes/a.md")).toBe("a.md");
    expect(findNode(root, "/notes/a.md")?.type).toBe("file");
    expect(isFolderPath(root, "/notes")).toBe(true);
    expect(isFolderPath(root, "/readme.md")).toBe(false);
  });

  it("treats a folder as ancestor of itself and its children", () => {
    expect(isDescendantPath("/notes", "/notes")).toBe(true);
    expect(isDescendantPath("/notes", "/notes/a.md")).toBe(true);
    expect(isDescendantPath("/", "/notes")).toBe(true);
    expect(isDescendantPath("/", "/")).toBe(false);
    expect(isDescendantPath("/notes", "/readme.md")).toBe(false);
  });
});

describe("uniqueName", () => {
  it("preserves the last extension when colliding", () => {
    expect(uniqueName(["notes.md"], "notes.md")).toBe("notes-2.md");
    expect(uniqueName(["notes.md", "notes-2.md"], "notes.md")).toBe("notes-3.md");
  });

  it("does not treat a leading-dot name as an extension split", () => {
    expect(uniqueName([".env"], ".env")).toBe(".env-2");
  });
});

describe("uniqueFolderName", () => {
  it("uses a space suffix, not a hyphen", () => {
    expect(uniqueFolderName(["Notes"], "Notes")).toBe("Notes 2");
    expect(uniqueFolderName(["Notes", "Notes 2"], "Notes")).toBe("Notes 3");
  });
});

describe("tree mutations", () => {
  it("addChild clones and leaves the original tree intact", () => {
    const root = rootWithNotes();
    const next = addChild(root, "/notes", { name: "b.md", type: "file" });
    expect(findNode(root, "/notes/b.md")).toBeNull();
    expect(findNode(next, "/notes/b.md")?.type).toBe("file");
  });

  it("refuses to add under a file", () => {
    const root = rootWithNotes();
    expect(addChild(root, "/readme.md", { name: "x", type: "file" })).toBe(root);
  });

  it("rename, remove, and collect file paths", () => {
    const root = rootWithNotes();
    const renamed = renameNode(root, "/readme.md", "intro.md");
    expect(findNode(renamed, "/intro.md")?.type).toBe("file");
    const removed = removeNode(renamed, "/notes/a.md");
    expect(collectFilePaths(removed)).toEqual(["/intro.md"]);
  });

  it("does not move a folder into itself", () => {
    const root = rootWithNotes();
    expect(moveNode(root, "/notes", "/notes")).toBe(root);
    expect(moveNode(root, "/notes", "/notes/a.md")).toBe(root);
  });

  it("moves a file into a folder", () => {
    const root = rootWithNotes();
    const moved = moveNode(root, "/readme.md", "/notes");
    expect(findNode(moved, "/readme.md")).toBeNull();
    expect(findNode(moved, "/notes/readme.md")?.type).toBe("file");
  });
});

describe("content path maps", () => {
  it("remaps a file and nested prefix", () => {
    const contents = { "/notes/a.md": "a", "/notes/b.md": "b", "/other.md": "c" };
    expect(remapContentPaths(contents, "/notes", "/docs")).toEqual({
      "/docs/a.md": "a",
      "/docs/b.md": "b",
      "/other.md": "c",
    });
  });

  it("removes a prefix including the exact path", () => {
    const contents = { "/notes/a.md": "a", "/other.md": "c" };
    expect(removeContentPaths(contents, "/notes")).toEqual({ "/other.md": "c" });
    expect(removeContentPaths(contents, "/notes/a.md")).toEqual({ "/other.md": "c" });
  });
});
