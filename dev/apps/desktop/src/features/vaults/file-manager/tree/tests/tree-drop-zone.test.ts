import { describe, expect, it } from "vitest";
import { visibleTreeRows, type FileTreeNode } from "@upriv/shared";
import { treeDropZoneEdges } from "../treeDropZone";

const tree: FileTreeNode = {
  name: "",
  type: "folder",
  children: [
    {
      name: "docs",
      type: "folder",
      children: [
        { name: "a.md", type: "file" },
        { name: "b.md", type: "file" },
      ],
    },
    { name: "empty", type: "folder", children: [] },
    { name: "readme.md", type: "file" },
  ],
};

describe("treeDropZoneEdges", () => {
  it("outlines a folder with the rows it shows below it", () => {
    const rows = visibleTreeRows(tree, ["/", "/docs"]);
    expect([...treeDropZoneEdges(rows, "/docs")]).toEqual([
      ["/docs", "first"],
      ["/docs/a.md", "middle"],
      ["/docs/b.md", "last"],
    ]);
  });

  it("outlines a collapsed or empty folder on its own row", () => {
    expect([...treeDropZoneEdges(visibleTreeRows(tree, ["/"]), "/docs")]).toEqual([
      ["/docs", "single"],
    ]);
    expect([...treeDropZoneEdges(visibleTreeRows(tree, ["/"]), "/empty")]).toEqual([
      ["/empty", "single"],
    ]);
  });

  it("outlines nothing for the root, a file, or no target", () => {
    const rows = visibleTreeRows(tree, ["/", "/docs"]);
    expect(treeDropZoneEdges(rows, "/").size).toBe(0);
    expect(treeDropZoneEdges(rows, "/readme.md").size).toBe(0);
    expect(treeDropZoneEdges(rows, null).size).toBe(0);
  });
});
