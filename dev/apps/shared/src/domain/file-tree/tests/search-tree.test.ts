import { describe, expect, it } from "vitest";
import { searchTreeRows } from "../searchTree";
import type { FileTreeNode } from "../types";

const root: FileTreeNode = {
  name: "Notes",
  type: "folder",
  children: [
    {
      name: "docs",
      type: "folder",
      children: [
        { name: "Report.md", type: "file" },
        { name: "plan.txt", type: "file" },
      ],
    },
    { name: "report-old.txt", type: "file" },
    { name: "photos", type: "folder", children: [{ name: "cat.png", type: "file" }] },
  ],
};

const paths = (query: string) => searchTreeRows(root, query).map((row) => row.path);

describe("searchTreeRows", () => {
  it("finds names in any case, under the folders that lead to them", () => {
    expect(paths("report")).toEqual(["/docs", "/docs/Report.md", "/report-old.txt"]);
  });

  it("keeps each row at its depth", () => {
    const depths = searchTreeRows(root, "cat").map((row) => row.depth);
    expect(depths).toEqual([0, 1]);
  });

  it("finds a folder by name without pulling in what is under it", () => {
    expect(paths("photos")).toEqual(["/photos"]);
  });

  it("ignores spaces around the query and finds nothing for an empty one", () => {
    expect(paths("  plan  ")).toEqual(["/docs", "/docs/plan.txt"]);
    expect(paths("   ")).toEqual([]);
  });

  it("keeps the entry being renamed, under its folders, whatever its name", () => {
    const rows = searchTreeRows(root, "zebra", { renamingPath: "/docs/plan.txt" });
    expect(rows.map((row) => row.path)).toEqual(["/docs", "/docs/plan.txt"]);
  });

  it("leaves out what sits under a collapsed folder and keeps the folder", () => {
    const rows = searchTreeRows(root, "report", { collapsed: new Set(["/docs"]) });
    expect(rows.map((row) => row.path)).toEqual(["/docs", "/report-old.txt"]);
  });

  it("keeps the entry being renamed inside a collapsed folder", () => {
    const rows = searchTreeRows(root, "report", {
      renamingPath: "/docs/Report.md",
      collapsed: new Set(["/docs"]),
    });
    expect(rows.map((row) => row.path)).toEqual(["/docs", "/docs/Report.md", "/report-old.txt"]);
  });

  it("finds nothing for a name no file has", () => {
    expect(paths("zebra")).toEqual([]);
  });
});
