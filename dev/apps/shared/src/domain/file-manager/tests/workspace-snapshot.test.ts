import { describe, expect, it } from "vitest";
import type { FileTreeNode } from "../../file-tree";
import {
  omitInternalVaultNodes,
  parseWorkspaceSnapshot,
  sanitizeWorkspaceSnapshot,
  serializeWorkspaceSnapshot,
  snapshotsEqual,
  workspaceSnapshotToHydrate,
  UPRIV_WORKSPACE_PATH,
  workspaceSnapshotFromState,
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
      explorerCollapsed: true,
      explorerSearchOpen: true,
      explorerSearchQuery: "report",
      files: { "/b.md": { markdownView: "source" } },
    });
    const parsed = parseWorkspaceSnapshot(raw);
    expect(parsed?.openTabs).toEqual(["/a.md", "/b.md"]);
    expect(parsed?.activeTabPath).toBe("/b.md");
    expect(parsed?.explorerCollapsed).toBe(true);
    expect(parsed?.explorerSearchOpen).toBe(true);
    expect(parsed?.explorerSearchQuery).toBe("report");
    expect(parsed?.files).toEqual({ "/b.md": { markdownView: "source" } });
  });

  it("loads a missing or non-string search query as no search", () => {
    expect(parseWorkspaceSnapshot('{"format_version":1,"openTabs":[]}')?.explorerSearchQuery).toBe(
      "",
    );
    expect(
      parseWorkspaceSnapshot('{"format_version":1,"openTabs":[],"explorerSearchQuery":7}')
        ?.explorerSearchQuery,
    ).toBe("");
  });

  it("loads a missing or non-true search flag as closed", () => {
    expect(parseWorkspaceSnapshot('{"format_version":1,"openTabs":[]}')?.explorerSearchOpen).toBe(
      false,
    );
    expect(
      parseWorkspaceSnapshot('{"format_version":1,"openTabs":[],"explorerSearchOpen":"yes"}')
        ?.explorerSearchOpen,
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

  it("drops per-file fields with invalid values and files left with none", () => {
    const parsed = parseWorkspaceSnapshot(
      JSON.stringify({
        format_version: 1,
        openTabs: [],
        files: {
          "/a.md": { markdownView: "nope", wordWrap: false },
          "/b.md": { markdownView: "nope", markdownOutlineOpen: 1 },
        },
      }),
    );
    expect(parsed?.files).toEqual({ "/a.md": { wordWrap: false } });
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
        explorerCollapsed: true,
        explorerSearchOpen: true,
        explorerSearchQuery: "nested",
      },
      tree,
    );
    expect(sanitized.openTabs).toEqual(["/a.md", "/notes/nested.md"]);
    expect(sanitized.activeTabPath).toBe("/notes/nested.md");
    expect(sanitized.expandedPaths).toEqual(["/", "/notes"]);
    expect(sanitized.selectedPath).toBe("/notes/nested.md");
    expect(sanitized.explorerCollapsed).toBe(true);
    expect(sanitized.explorerSearchOpen).toBe(true);
    expect(sanitized.explorerSearchQuery).toBe("nested");
  });

  it("omits internal file from explorer tree", () => {
    const visible = omitInternalVaultNodes(tree);
    expect(visible.children?.some((c) => c.name === ".upriv-workspace.json")).toBe(false);
    expect(visible.children?.some((c) => c.name === "a.md")).toBe(true);
  });

  it("snapshots the layout without drafts", () => {
    let state = createDefaultWorkspaceState();
    state = {
      ...state,
      openTabs: ["/a.md"],
      activeTabPath: "/a.md",
      selectedPath: "/a.md",
      expandedPaths: ["/", "/notes"],
      explorerCollapsed: true,
      fileStates: { "/a.md": { markdownView: "source" } },
      dirtyPaths: ["/a.md"],
      editorDrafts: { "/a.md": "draft" },
    };
    const snap = workspaceSnapshotFromState(state);
    expect(snap.openTabs).toEqual(["/a.md"]);
    expect(snap.files).toEqual({ "/a.md": { markdownView: "source" } });
    expect(snap.explorerCollapsed).toBe(true);
    expect(snap).not.toHaveProperty("dirtyPaths");
    expect(snap).not.toHaveProperty("editorDrafts");
  });

  it("hydrates a disk snapshot only when memory is still the cold-open layout", () => {
    const empty = workspaceSnapshotFromState(createDefaultWorkspaceState());
    const loaded = { ...empty, openTabs: ["/a.md"], activeTabPath: "/a.md", selectedPath: "/a.md" };
    const edited = { ...empty, openTabs: ["/b.md"], activeTabPath: "/b.md", selectedPath: "/b.md" };
    const shouldHydratePersistedWorkspace = (
      mount: typeof empty,
      current: typeof empty,
      saved: typeof empty,
    ) => workspaceSnapshotToHydrate(mount, current, saved) != null;
    expect(shouldHydratePersistedWorkspace(empty, empty, loaded)).toBe(true);
    expect(shouldHydratePersistedWorkspace(loaded, loaded, loaded)).toBe(false);
    expect(shouldHydratePersistedWorkspace(empty, edited, loaded)).toBe(false);
    expect(shouldHydratePersistedWorkspace(edited, edited, empty)).toBe(false);
    const sourceOnly = { ...empty, files: { "/a.md": { markdownView: "source" as const } } };
    expect(shouldHydratePersistedWorkspace(empty, empty, sourceOnly)).toBe(true);
    expect(shouldHydratePersistedWorkspace(empty, sourceOnly, sourceOnly)).toBe(false);
    const hiddenOnly = { ...empty, explorerCollapsed: true };
    expect(shouldHydratePersistedWorkspace(empty, empty, hiddenOnly)).toBe(true);
    expect(shouldHydratePersistedWorkspace(empty, hiddenOnly, hiddenOnly)).toBe(false);
    const outlineClosed = { ...empty, files: { "/a.md": { markdownOutlineOpen: false } } };
    expect(shouldHydratePersistedWorkspace(empty, empty, outlineClosed)).toBe(true);
    expect(shouldHydratePersistedWorkspace(empty, outlineClosed, outlineClosed)).toBe(false);
  });

  it("keeps a chrome toggle made while tabs are still loading", () => {
    const empty = workspaceSnapshotFromState(createDefaultWorkspaceState());
    const hidden = { ...empty, explorerCollapsed: true };
    const saved = {
      ...empty,
      openTabs: ["/a.md"],
      activeTabPath: "/a.md",
      selectedPath: "/a.md",
      files: { "/a.md": { markdownView: "source" as const } },
    };
    expect(workspaceSnapshotToHydrate(empty, hidden, saved)).toEqual({
      ...saved,
      explorerCollapsed: true,
    });
  });

  it("restores the search bar, and keeps one opened or closed while tabs are loading", () => {
    const empty = workspaceSnapshotFromState(createDefaultWorkspaceState());
    const saved = { ...empty, openTabs: ["/a.md"], activeTabPath: "/a.md", selectedPath: "/a.md" };
    const savedOpen = { ...saved, explorerSearchOpen: true };
    expect(workspaceSnapshotToHydrate(empty, empty, savedOpen)?.explorerSearchOpen).toBe(true);

    const opened = { ...empty, explorerSearchOpen: true };
    expect(workspaceSnapshotToHydrate(empty, opened, saved)?.explorerSearchOpen).toBe(true);
    expect(workspaceSnapshotToHydrate(opened, empty, savedOpen)?.explorerSearchOpen).toBe(false);
  });

  it("restores the search text, and keeps what was typed while tabs are loading", () => {
    const empty = workspaceSnapshotFromState(createDefaultWorkspaceState());
    const saved = { ...empty, openTabs: ["/a.md"], activeTabPath: "/a.md", selectedPath: "/a.md" };
    const savedQuery = { ...saved, explorerSearchQuery: "report" };
    expect(workspaceSnapshotToHydrate(empty, empty, savedQuery)?.explorerSearchQuery).toBe(
      "report",
    );

    const typed = { ...empty, explorerSearchQuery: "plan" };
    expect(workspaceSnapshotToHydrate(empty, typed, savedQuery)?.explorerSearchQuery).toBe("plan");
  });

  it("counts the search bar and its text as layout changes", () => {
    const empty = workspaceSnapshotFromState(createDefaultWorkspaceState());
    expect(snapshotsEqual(empty, { ...empty, explorerSearchOpen: true })).toBe(false);
    expect(snapshotsEqual(empty, { ...empty, explorerSearchQuery: "report" })).toBe(false);
  });

  it("parses and sanitizes per-file states and treeSplitPercent", () => {
    const raw = JSON.stringify({
      format_version: 1,
      openTabs: ["/notes/a.md"],
      activeTabPath: "/notes/a.md",
      expandedPaths: ["/", "/notes"],
      selectedPath: "/notes/a.md",
      explorerCollapsed: false,
      treeSplitPercent: 28,
      files: {
        "/notes/a.md": {
          markdownView: "source",
          markdownOutlineOpen: false,
          searchQuery: "password123",
          wordWrap: true,
        },
        "/deleted.md": {
          markdownView: "source",
        },
        "/.upriv-workspace.json": {
          markdownView: "source",
        },
      },
    });

    const parsed = parseWorkspaceSnapshot(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.treeSplitPercent).toBe(28);
    expect(parsed?.files?.["/notes/a.md"]).toEqual({
      markdownView: "source",
      markdownOutlineOpen: false,
      searchQuery: "password123",
      wordWrap: true,
    });
    expect(parsed?.files?.["/.upriv-workspace.json"]).toBeUndefined();

    // Sanitize with a tree where /notes/a.md exists, but /deleted.md does not
    const tree: FileTreeNode = {
      name: "",
      type: "folder",
      children: [
        {
          name: "notes",
          type: "folder",
          children: [
            {
              name: "a.md",
              type: "file",
            },
          ],
        },
      ],
    };

    const sanitized = sanitizeWorkspaceSnapshot(parsed!, tree);
    expect(sanitized.files?.["/notes/a.md"]).toBeDefined();
    expect(sanitized.files?.["/notes/a.md"]?.wordWrap).toBe(true);
    expect(sanitized.files?.["/deleted.md"]).toBeUndefined();
    expect(sanitized.treeSplitPercent).toBe(28);
  });
});
