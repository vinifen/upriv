import { describe, expect, it } from "vitest";
import type { FileTreeNode } from "../../file-tree";
import {
  omitInternalVaultNodes,
  parseWorkspaceSnapshot,
  sanitizeWorkspaceSnapshot,
  serializeWorkspaceSnapshot,
  shouldHydratePersistedWorkspace,
  workspaceSnapshotToHydrate,
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
      markdownView: "source",
      explorerCollapsed: true,
      markdownOutlineOpen: true,
    });
    const parsed = parseWorkspaceSnapshot(raw);
    expect(parsed?.openTabs).toEqual(["/a.md", "/b.md"]);
    expect(parsed?.activeTabPath).toBe("/b.md");
    expect(parsed?.markdownView).toBe("source");
    expect(parsed?.explorerCollapsed).toBe(true);
    expect(parsed?.markdownOutlineOpen).toBe(true);
  });

  it("loads a missing or non-true outline flag as hidden", () => {
    expect(parseWorkspaceSnapshot('{"format_version":1,"openTabs":[]}')?.markdownOutlineOpen).toBe(
      false,
    );
    expect(
      parseWorkspaceSnapshot('{"format_version":1,"openTabs":[],"markdownOutlineOpen":1}')
        ?.markdownOutlineOpen,
    ).toBe(false);
  });

  it("loads a missing or non-true explorer flag as shown", () => {
    expect(parseWorkspaceSnapshot('{"format_version":1,"openTabs":[]}')?.explorerCollapsed).toBe(
      false,
    );
    expect(
      parseWorkspaceSnapshot('{"format_version":1,"openTabs":[],"explorerCollapsed":"yes"}')
        ?.explorerCollapsed,
    ).toBe(false);
  });

  it("loads a missing or invalid markdown view as preview", () => {
    expect(parseWorkspaceSnapshot('{"format_version":1,"openTabs":[]}')?.markdownView).toBe(
      "preview",
    );
    expect(
      parseWorkspaceSnapshot('{"format_version":1,"openTabs":[],"markdownView":"nope"}')
        ?.markdownView,
    ).toBe("preview");
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
        markdownView: "source",
        explorerCollapsed: true,
        markdownOutlineOpen: true,
      },
      tree,
    );
    expect(sanitized.openTabs).toEqual(["/a.md", "/notes/nested.md"]);
    expect(sanitized.activeTabPath).toBe("/notes/nested.md");
    expect(sanitized.expandedPaths).toEqual(["/", "/notes"]);
    expect(sanitized.selectedPath).toBe("/notes/nested.md");
    expect(sanitized.markdownView).toBe("source");
    expect(sanitized.explorerCollapsed).toBe(true);
    expect(sanitized.markdownOutlineOpen).toBe(true);
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
      markdownView: "source",
      explorerCollapsed: true,
      markdownOutlineOpen: true,
      dirtyPaths: ["/a.md"],
      editorDrafts: { "/a.md": "draft" },
    };
    const snap = workspaceSnapshotFromState(state);
    expect(snap.openTabs).toEqual(["/a.md"]);
    const restored = workspaceStateFromSnapshot(snap);
    expect(restored.openTabs).toEqual(["/a.md"]);
    expect(restored.markdownView).toBe("source");
    expect(restored.explorerCollapsed).toBe(true);
    expect(restored.markdownOutlineOpen).toBe(true);
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
    const sourceOnly = { ...empty, markdownView: "source" as const };
    expect(shouldHydratePersistedWorkspace(empty, empty, sourceOnly)).toBe(true);
    expect(shouldHydratePersistedWorkspace(empty, sourceOnly, sourceOnly)).toBe(false);
    const hiddenOnly = { ...empty, explorerCollapsed: true };
    expect(shouldHydratePersistedWorkspace(empty, empty, hiddenOnly)).toBe(true);
    expect(shouldHydratePersistedWorkspace(empty, hiddenOnly, hiddenOnly)).toBe(false);
    const outlineOnly = { ...empty, markdownOutlineOpen: true };
    expect(shouldHydratePersistedWorkspace(empty, empty, outlineOnly)).toBe(true);
  });

  it("keeps a chrome toggle made while tabs are still loading", () => {
    const empty = workspaceSnapshotFromState(createDefaultWorkspaceState());
    const hidden = { ...empty, explorerCollapsed: true };
    const saved = {
      ...empty,
      openTabs: ["/a.md"],
      activeTabPath: "/a.md",
      selectedPath: "/a.md",
      markdownView: "source" as const,
    };
    expect(workspaceSnapshotToHydrate(empty, hidden, saved)).toEqual({
      ...saved,
      explorerCollapsed: true,
    });
    expect(shouldHydratePersistedWorkspace(empty, hidden, saved)).toBe(true);
  });
});
