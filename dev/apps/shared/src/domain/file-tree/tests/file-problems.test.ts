import { describe, expect, it } from "vitest";
import { RpcError } from "../../core-rpc/errors";
import {
  editorFileProblem,
  fileProblemMark,
  fileProblemOfError,
  fileProblemRows,
  treeFileProblems,
  treeMarkBehindRead,
} from "../fileProblems";
import { parseFileTreeNode } from "../parse";
import type { FileProblem, FileTreeNode } from "../types";

const file = (name: string, problem?: FileProblem): FileTreeNode =>
  problem ? { name, type: "file", problem } : { name, type: "file" };
const folder = (name: string, children: FileTreeNode[]): FileTreeNode => ({
  name,
  type: "folder",
  children,
});
const root = (children: FileTreeNode[]) => folder("Notes", children);

describe("editorFileProblem and treeMarkBehindRead", () => {
  const problems = treeFileProblems(root([file("gone.txt", "missing"), file("fine.txt")]));

  it("shows the tree's mark until a read lands, and a read's own problem", () => {
    expect(editorFileProblem(problems, "/gone.txt", undefined)).toBe("missing");
    expect(editorFileProblem(problems, "/fine.txt", undefined)).toBeNull();
    expect(
      editorFileProblem(problems, "/fine.txt", {
        state: "failed",
        revision: 1,
        problem: "damaged",
      }),
    ).toBe("damaged");
    expect(editorFileProblem(problems, "/gone.txt", { state: "failed", revision: 1 })).toBe(
      "missing",
    );
  });

  it("lets a file that read in full show, and says the tree is behind", () => {
    const loaded = { state: "loaded", text: "back", revision: 2 } as const;
    expect(editorFileProblem(problems, "/gone.txt", loaded)).toBeNull();
    expect(treeMarkBehindRead(problems, { "/gone.txt": loaded })).toBe(true);
    expect(treeMarkBehindRead(problems, { "/fine.txt": loaded })).toBe(false);
    expect(treeMarkBehindRead(null, { "/gone.txt": loaded })).toBe(false);
  });
});

describe("treeFileProblems", () => {
  it("is null while every file reads", () => {
    expect(treeFileProblems(root([file("a.txt"), folder("docs", [file("b.txt")])]))).toBeNull();
  });

  it("lists each marked file and every folder above it, not the root", () => {
    const problems = treeFileProblems(
      root([
        file("a.txt"),
        folder("docs", [folder("old", [file("gone.pdf", "missing")]), file("fine.txt")]),
        folder("clean", [file("c.txt")]),
        file("bad.bin", "damaged"),
      ]),
    );
    expect(problems && [...problems.files]).toEqual([
      ["/docs/old/gone.pdf", "missing"],
      ["/bad.bin", "damaged"],
    ]);
    expect(problems && [...problems.folders].sort()).toEqual(["/docs", "/docs/old"]);
  });
});

describe("fileProblemMark", () => {
  const problems = treeFileProblems(root([folder("docs", [file("gone.pdf", "missing")])]));

  it("marks the file with its problem and the folders above it as holding one", () => {
    expect(fileProblemMark(problems, "/docs/gone.pdf")).toBe("missing");
    expect(fileProblemMark(problems, "/docs")).toBe("inside");
    expect(fileProblemMark(problems, "/other.txt")).toBeNull();
    expect(fileProblemMark(null, "/docs")).toBeNull();
  });
});

describe("fileProblemRows", () => {
  const tree = root([
    file("a.txt"),
    folder("docs", [file("gone.pdf", "missing"), file("fine.txt")]),
    file("bad.bin", "damaged"),
  ]);
  const problems = treeFileProblems(tree);

  it("keeps only the marked files and the folders that lead to them", () => {
    expect(problems).not.toBeNull();
    if (!problems) return;
    const rows = fileProblemRows(tree, problems, ["/docs"]);
    expect(rows.map((row) => row.path)).toEqual(["/docs", "/docs/gone.pdf", "/bad.bin"]);
  });

  it("follows the explorer's own expanded folders", () => {
    if (!problems) return;
    const rows = fileProblemRows(tree, problems, []);
    expect(rows.map((row) => row.path)).toEqual(["/docs", "/bad.bin"]);
  });
});

describe("fileProblemOfError", () => {
  it("reads the problem core names for an unreadable file", () => {
    const missing = new RpcError("vault_file_unreadable", "x", { problem: "missing" });
    const damaged = new RpcError("vault_file_unreadable", "x", { problem: "damaged" });
    expect(fileProblemOfError(missing)).toBe("missing");
    expect(fileProblemOfError(damaged)).toBe("damaged");
  });

  it("treats an unreadable file without details as damaged", () => {
    expect(fileProblemOfError(new RpcError("vault_file_unreadable", "x"))).toBe("damaged");
  });

  it("is null for any other failure", () => {
    expect(fileProblemOfError(new RpcError("vault_not_open", "x"))).toBeNull();
    expect(fileProblemOfError(new Error("boom"))).toBeNull();
  });
});

describe("parseFileTreeNode", () => {
  it("keeps a known problem on a file and drops anything else", () => {
    const parsed = parseFileTreeNode({
      name: "Notes",
      type: "folder",
      children: [
        { name: "gone.pdf", type: "file", problem: "missing" },
        { name: "odd.txt", type: "file", problem: "unheard-of" },
      ],
    });
    expect(parsed.children?.[0]).toEqual({ name: "gone.pdf", type: "file", problem: "missing" });
    expect(parsed.children?.[1]).toEqual({ name: "odd.txt", type: "file" });
  });
});
