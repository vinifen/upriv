import { describe, expect, it } from "vitest";
import { createDefaultWorkspaceState, type FileTreeNode } from "@upriv/shared";
import { osFileImportParentPath } from "../osFileImportTarget";

const tree: FileTreeNode = {
  name: "",
  type: "folder",
  children: [
    { name: "photos", type: "folder", children: [] },
    { name: "note.md", type: "file" },
  ],
};

describe("osFileImportParentPath", () => {
  it("prefers the highlighted drop folder", () => {
    const workspace = {
      ...createDefaultWorkspaceState(),
      dropTargetPath: "/photos",
      selectedPath: "/note.md",
    };
    expect(osFileImportParentPath(tree, workspace)).toBe("/photos");
  });

  it("uses the selected folder when nothing is hovered", () => {
    const workspace = { ...createDefaultWorkspaceState(), selectedPath: "/photos" };
    expect(osFileImportParentPath(tree, workspace)).toBe("/photos");
  });

  it("uses the parent of a selected file", () => {
    const workspace = { ...createDefaultWorkspaceState(), selectedPath: "/note.md" };
    expect(osFileImportParentPath(tree, workspace)).toBe("/");
  });
});
