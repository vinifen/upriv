import { describe, expect, it } from "vitest";
import { treeFolderPresence } from "../folderPresence";
import type { FileTreeNode } from "../types";

function tree(children: FileTreeNode[]): FileTreeNode {
  return { name: "Notes", type: "folder", inFolder: true, children };
}

const file = (name: string, inFolder: boolean): FileTreeNode => ({ name, type: "file", inFolder });
const folder = (name: string, inFolder: boolean, children: FileTreeNode[]): FileTreeNode => ({
  name,
  type: "folder",
  inFolder,
  children,
});

describe("treeFolderPresence", () => {
  it("is null for a vault whose tree carries no marks", () => {
    expect(treeFolderPresence({ name: "Notes", type: "folder", children: [] })).toBeNull();
  });

  it("marks files by what the folder holds", () => {
    const presence = treeFolderPresence(tree([file("a.txt", true), file("b.txt", false)]));
    expect(presence?.get("/a.txt")).toBe("all");
    expect(presence?.get("/b.txt")).toBe("none");
  });

  it("counts the files under a folder", () => {
    const presence = treeFolderPresence(
      tree([
        folder("some", true, [file("a.txt", true), file("b.txt", false)]),
        folder("all", true, [file("c.txt", true)]),
        folder("none", false, [file("d.txt", false)]),
      ]),
    );
    expect(presence?.get("/some")).toBe("some");
    expect(presence?.get("/all")).toBe("all");
    expect(presence?.get("/none")).toBe("none");
    expect(presence?.get("/")).toBe("some");
  });

  it("lets an empty folder count itself", () => {
    const presence = treeFolderPresence(
      tree([folder("sent", true, []), folder("not-sent", false, [])]),
    );
    expect(presence?.get("/sent")).toBe("all");
    expect(presence?.get("/not-sent")).toBe("none");
  });

  it("offers nothing for the root of a vault with no files", () => {
    expect(treeFolderPresence(tree([]))?.has("/")).toBe(false);
    expect(treeFolderPresence(tree([folder("empty", false, [])]))?.has("/")).toBe(false);
  });
});
