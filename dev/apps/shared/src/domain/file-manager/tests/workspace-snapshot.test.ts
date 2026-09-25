import { describe, expect, it } from "vitest";
import type { FileTreeNode } from "../../file-tree";
import {
  omitInternalVaultNodes,
  parseWorkspaceSnapshot,
  sanitizeWorkspaceSnapshot,
  serializeWorkspaceSnapshot,
  shouldHydratePersistedWorkspace,
  UPRIV_WORKSPACE_PATH,
  workspaceSnapshotFromState,
  workspaceStateFromSnapshot,
} from "../workspaceSnapshot";
import { createDefaultWorkspaceState } from "../workspaceTypes";

const tree: FileTreeNode = {
  name: "",
  type: "folder",
  children: [
    { name: "a.md", type: "file" },
    { name: "b.md", type: "file" },
    {
      name: "notes",
      type: "folder",
      children: [{ name: "nested.md", type: "file" }],
    },
    { name: ".upriv-workspace.json", type: "file" },
  ],
};

describe("workspaceSnapshot", () => {
  it("parses and serializes v1", () => {
    const raw = serializeWorkspaceSnapshot({
      format_version: 1,
      openTabs: ["/a.md", "/b.md"],
      activeTabPath: "/b.md",
      expandedPaths: ["/", "/notes"],
      selectedPath: "/b.md",
    });
    const parsed = parseWorkspaceSnapshot(raw);
    expect(parsed?.openTabs).toEqual(["/a.md", "/b.md"]);
    expect(parsed?.activeTabPath).toBe("/b.md");
  });

  it("ignores legacy treeSplitPercent in older snapshots", () => {
    const parsed = parseWorkspaceSnapshot(
      JSON.stringify({
        format_version: 1,
        openTabs: ["/a.md"],
        activeTabPath: "/a.md",
        expandedPaths: ["/"],
        selectedPath: "/a.md",
        treeSplitPercent: 40,
      }),
    );
    expect(parsed?.openTabs).toEqual(["/a.md"]);
    expect(parsed && "treeSplitPercent" in parsed).toBe(false);
  });

  it("rejects corrupt or wrong version", () => {
    expect(parseWorkspaceSnapshot("not-json")).toBeNull();
    expect(parseWorkspaceSnapshot('{"format_version":99,"openTabs":[]}')).toBeNull();
  });

  it("sanitizes against vault tree as source of truth", () => {
    const sanitized = sanitizeWorkspaceSnapshot(
      {
        format_version: 1,
        openTabs: ["/a.md", "/gone.md", UPRIV_WORKSPACE_PATH, "/notes/nested.md"],
        activeTabPath: "/gone.md",
        expandedPaths: ["/", "/notes", "/missing"],
        selectedPath: "/gone.md",
      },
      tree,
    );
    expect(sanitized.openTabs).toEqual(["/a.md", "/notes/nested.md"]);
    expect(sanitized.activeTabPath).toBe("/notes/nested.md");
    expect(sanitized.expandedPaths).toEqual(["/", "/notes"]);
    expect(sanitized.selectedPath).toBe("/notes/nested.md");
  });

  it("omits internal file from explorer tree", () => {
    const visible = omitInternalVaultNodes(tree);
    expect(visible.children?.some((c) => c.name === ".upriv-workspace.json")).toBe(false);
    expect(visible.children?.some((c) => c.name === "a.md")).toBe(true);
  });

  it("round-trips state ↔ snapshot without drafts", () => {
    let state = createDefaultWorkspaceState();
    state = {
      ...state,
      openTabs: ["/a.md"],
      activeTabPath: "/a.md",
      selectedPath: "/a.md",
      expandedPaths: ["/", "/notes"],
      dirtyPaths: ["/a.md"],
      editorDrafts: { "/a.md": "draft" },
    };
    const snap = workspaceSnapshotFromState(state);
    expect(snap.openTabs).toEqual(["/a.md"]);
    const restored = workspaceStateFromSnapshot(snap);
    expect(restored.openTabs).toEqual(["/a.md"]);
    expect(restored.dirtyPaths).toEqual([]);
    expect(restored.editorDrafts).toEqual({});
  });

  it("hydrates a disk snapshot only when memory is still the cold-open layout", () => {
    const empty = workspaceSnapshotFromState(createDefaultWorkspaceState());
    const loaded = { ...empty, openTabs: ["/a.md"], activeTabPath: "/a.md", selectedPath: "/a.md" };
    const edited = { ...empty, openTabs: ["/b.md"], activeTabPath: "/b.md", selectedPath: "/b.md" };
    expect(shouldHydratePersistedWorkspace(empty, empty, loaded)).toBe(true);
    expect(shouldHydratePersistedWorkspace(loaded, loaded, loaded)).toBe(false);
    expect(shouldHydratePersistedWorkspace(empty, edited, loaded)).toBe(false);
    expect(shouldHydratePersistedWorkspace(edited, edited, empty)).toBe(false);
  });
});
