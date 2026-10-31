/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultWorkspaceState,
  serializeWorkspaceSnapshot,
  workspaceSnapshotFromState,
  type FileTreeNode,
  type VaultFileSystemService,
  type VaultWorkspaceAction,
  type VaultWorkspaceState,
} from "@upriv/shared";
import { useWorkspacePersistence, WORKSPACE_WRITE_DELAY_MS } from "@upriv/shared/react";

function stubFs(overrides: Partial<VaultFileSystemService> = {}): VaultFileSystemService {
  return {
    resetSession: () => undefined,
    getTreeRevision: async () => 0,
    getFileTree: async () => ({
      name: "",
      type: "folder",
      children: [{ name: "a.md", type: "file" }],
    }),
    getFileContent: async () => null,
    isFileEditable: () => true,
    isFileViewable: () => true,
    isFileImage: () => false,
    setFileContent: async () => 1,
    createFile: async () => null,
    importFile: async () => null,
    importFileFromBytes: async () => null,
    importFileFromOsPath: async () => null,
    createFolder: async () => null,
    ensureFolder: async () => null,
    renamePath: async () => null,
    deletePath: async () => false,
    movePath: async () => null,
    osPath: async () => {
      throw new Error("osPath not stubbed");
    },
    sendToFolder: async () => 0,
    removeFromFolder: async () => ({ removed: 0, kept: 0 }),
    previewFits: async () => true,
    languageFromPath: () => "text",
    ...overrides,
  };
}

function hydrateCalls(dispatch: { mock: { calls: unknown[][] } }): VaultWorkspaceAction[] {
  return dispatch.mock.calls
    .map((call) => call[0] as VaultWorkspaceAction)
    .filter((action) => action.type === "hydrate_persisted");
}

/** Applies a layout change on fake timers and runs out the write delay. */
async function changePastWriteDelay(change: () => void): Promise<void> {
  vi.useFakeTimers();
  change();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(WORKSPACE_WRITE_DELAY_MS);
  });
  vi.useRealTimers();
}

describe("useWorkspacePersistence", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("restores a disk snapshot onto a cold-open layout", async () => {
    const empty = createDefaultWorkspaceState();
    const loaded = {
      ...empty,
      openTabs: ["/a.md"],
      activeTabPath: "/a.md",
      selectedPath: "/a.md",
    };
    const fs = stubFs({
      getFileContent: async () => ({
        language: "text",
        content: serializeWorkspaceSnapshot(workspaceSnapshotFromState(loaded)),
      }),
    });
    const dispatch = vi.fn();
    renderHook(() =>
      useWorkspacePersistence({ vaultId: "notes", workspace: empty, tree: null, fs, dispatch }),
    );

    await waitFor(() => {
      expect(hydrateCalls(dispatch)).toHaveLength(1);
    });
    expect(hydrateCalls(dispatch)[0]).toMatchObject({
      type: "hydrate_persisted",
      openTabs: ["/a.md"],
      activeTabPath: "/a.md",
    });
  });

  it("restores saved tabs when the explorer is hidden during the load", async () => {
    const empty = createDefaultWorkspaceState();
    const hidden = { ...empty, explorerCollapsed: true };
    const loaded = {
      ...empty,
      openTabs: ["/a.md"],
      activeTabPath: "/a.md",
      selectedPath: "/a.md",
    };
    let resolveRead: (value: { content: string; language: "text" }) => void = () => undefined;
    const setFileContent = vi.fn(async () => 1);
    const fs = stubFs({
      getFileContent: () =>
        new Promise<{ content: string; language: "text" }>((resolve) => {
          resolveRead = resolve;
        }),
      setFileContent,
    });
    const dispatch = vi.fn();
    const { rerender } = renderHook(
      (props: { workspace: VaultWorkspaceState }) =>
        useWorkspacePersistence({
          vaultId: "notes",
          workspace: props.workspace,
          tree: null,
          fs,
          dispatch,
        }),
      { initialProps: { workspace: empty } },
    );
    vi.useFakeTimers();
    rerender({ workspace: hidden });
    await act(async () => {
      resolveRead({
        language: "text",
        content: serializeWorkspaceSnapshot(workspaceSnapshotFromState(loaded)),
      });
    });
    // The load must not schedule a write of the layout it replaced.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WORKSPACE_WRITE_DELAY_MS);
    });
    vi.useRealTimers();
    expect(hydrateCalls(dispatch)).toHaveLength(1);
    expect(hydrateCalls(dispatch)[0]).toMatchObject({
      openTabs: ["/a.md"],
      explorerCollapsed: true,
    });
    expect(setFileContent).not.toHaveBeenCalled();
  });

  it("does not close an opened tab when dispatch identity changes mid-load", async () => {
    let resolveRead: (value: { content: string; language: "text" }) => void = () => undefined;
    const getFileContent = vi.fn(
      () =>
        new Promise<{ content: string; language: "text" }>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const fs = stubFs({
      getFileContent: getFileContent as VaultFileSystemService["getFileContent"],
    });
    const dispatch = vi.fn();
    const empty = createDefaultWorkspaceState();
    const opened: VaultWorkspaceState = {
      ...empty,
      openTabs: ["/a.md"],
      activeTabPath: "/a.md",
      selectedPath: "/a.md",
    };

    const { rerender } = renderHook(
      (props: { workspace: VaultWorkspaceState; dispatch: typeof dispatch }) =>
        useWorkspacePersistence({
          vaultId: "teste",
          workspace: props.workspace,
          tree: null,
          fs,
          dispatch: props.dispatch,
        }),
      { initialProps: { workspace: empty, dispatch } },
    );

    const dispatch2 = vi.fn();
    rerender({ workspace: opened, dispatch: dispatch2 });

    await act(async () => {
      resolveRead({
        language: "text",
        content: serializeWorkspaceSnapshot(workspaceSnapshotFromState(empty)),
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(getFileContent.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(getFileContent.mock.calls.length).toBeLessThanOrEqual(2);
    expect(hydrateCalls(dispatch)).toHaveLength(0);
    expect(hydrateCalls(dispatch2)).toHaveLength(0);
  });

  it("does not write layout while a drop target is highlighted", async () => {
    const setFileContent = vi.fn(async () => 1);
    const getFileContent = vi.fn(async () => null);
    const fs = stubFs({ setFileContent, getFileContent });
    const empty = createDefaultWorkspaceState();
    const { rerender } = renderHook(
      (props: { workspace: VaultWorkspaceState }) =>
        useWorkspacePersistence({
          vaultId: "notes",
          workspace: props.workspace,
          tree: null,
          fs,
          dispatch: vi.fn(),
        }),
      { initialProps: { workspace: empty } },
    );

    await waitFor(() => expect(getFileContent).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    setFileContent.mockClear();

    await changePastWriteDelay(() =>
      rerender({
        workspace: { ...empty, dropTargetPath: "/photos", expandedPaths: ["/", "/photos"] },
      }),
    );
    expect(setFileContent).not.toHaveBeenCalled();

    await changePastWriteDelay(() =>
      rerender({
        workspace: { ...empty, dropTargetPath: null, expandedPaths: ["/", "/photos"] },
      }),
    );
    await waitFor(() => expect(setFileContent).toHaveBeenCalled());
  });

  it("writes a burst of search keys once, with the last query", async () => {
    const setFileContent = vi.fn<VaultFileSystemService["setFileContent"]>(async () => 1);
    const getFileContent = vi.fn(async () => null);
    const fs = stubFs({ setFileContent, getFileContent });
    const empty = createDefaultWorkspaceState();
    const { rerender } = renderHook(
      (props: { workspace: VaultWorkspaceState }) =>
        useWorkspacePersistence({
          vaultId: "notes",
          workspace: props.workspace,
          tree: null,
          fs,
          dispatch: vi.fn(),
        }),
      { initialProps: { workspace: empty } },
    );
    await waitFor(() => expect(getFileContent).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    setFileContent.mockClear();

    vi.useFakeTimers();
    for (const searchQuery of ["p", "pa", "pas", "pass"]) {
      rerender({ workspace: { ...empty, fileStates: { "/a.md": { searchQuery } } } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(WORKSPACE_WRITE_DELAY_MS - 1);
      });
    }
    expect(setFileContent).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WORKSPACE_WRITE_DELAY_MS * 2);
    });
    vi.useRealTimers();
    await waitFor(() => expect(setFileContent).toHaveBeenCalled());
    expect(setFileContent).toHaveBeenCalledTimes(1);
    expect(setFileContent.mock.calls[0]?.[2]).toContain('"searchQuery": "pass"');
  });

  it("writes explorerCollapsed when the explorer is hidden", async () => {
    const setFileContent = vi.fn<VaultFileSystemService["setFileContent"]>(async () => 1);
    const getFileContent = vi.fn(async () => null);
    const fs = stubFs({ setFileContent, getFileContent });
    const empty = createDefaultWorkspaceState();
    const { rerender } = renderHook(
      (props: { workspace: VaultWorkspaceState }) =>
        useWorkspacePersistence({
          vaultId: "notes",
          workspace: props.workspace,
          tree: null,
          fs,
          dispatch: vi.fn(),
        }),
      { initialProps: { workspace: empty } },
    );

    await waitFor(() => expect(getFileContent).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    setFileContent.mockClear();

    await changePastWriteDelay(() =>
      rerender({ workspace: { ...empty, explorerCollapsed: true } }),
    );
    await waitFor(() => expect(setFileContent).toHaveBeenCalled());
    const written = setFileContent.mock.calls.at(-1)?.[2] ?? "";
    expect(written).toContain('"explorerCollapsed": true');
  });

  it.each<[string, Partial<VaultWorkspaceState>, string]>([
    [
      "a file's view",
      { fileStates: { "/a.md": { markdownView: "source" } } },
      '"markdownView": "source"',
    ],
    [
      "a file's outline",
      { fileStates: { "/a.md": { markdownOutlineOpen: false } } },
      '"markdownOutlineOpen": false',
    ],
    ["a file's word wrap", { fileStates: { "/a.md": { wordWrap: false } } }, '"wordWrap": false'],
    ["the explorer split", { treeSplitPercent: 35 }, '"treeSplitPercent": 35'],
    ["the explorer search bar", { explorerSearchOpen: true }, '"explorerSearchOpen": true'],
    [
      "the explorer search text",
      { explorerSearchQuery: "report" },
      '"explorerSearchQuery": "report"',
    ],
  ])("writes %s when it changes", async (_label, change, expected) => {
    const setFileContent = vi.fn<VaultFileSystemService["setFileContent"]>(async () => 1);
    const getFileContent = vi.fn(async () => null);
    const fs = stubFs({ setFileContent, getFileContent });
    const empty = createDefaultWorkspaceState();
    const { rerender } = renderHook(
      (props: { workspace: VaultWorkspaceState }) =>
        useWorkspacePersistence({
          vaultId: "notes",
          workspace: props.workspace,
          tree: null,
          fs,
          dispatch: vi.fn(),
        }),
      { initialProps: { workspace: empty } },
    );

    await waitFor(() => expect(getFileContent).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    setFileContent.mockClear();

    await changePastWriteDelay(() => rerender({ workspace: { ...empty, ...change } }));
    await waitFor(() => expect(setFileContent).toHaveBeenCalled());
    const written = setFileContent.mock.calls.at(-1)?.[2] ?? "";
    expect(written).toContain(expected);
  });

  it("checks a write against the loaded tree without listing the vault", async () => {
    const setFileContent = vi.fn<VaultFileSystemService["setFileContent"]>(async () => 1);
    const getFileContent = vi.fn(async () => null);
    const getFileTree = vi.fn<VaultFileSystemService["getFileTree"]>();
    const fs = stubFs({ setFileContent, getFileContent, getFileTree });
    const tree: FileTreeNode = {
      name: "",
      type: "folder",
      children: [{ name: "b.md", type: "file" }],
    };
    const empty = createDefaultWorkspaceState();
    const { rerender } = renderHook(
      (props: { workspace: VaultWorkspaceState }) =>
        useWorkspacePersistence({
          vaultId: "notes",
          workspace: props.workspace,
          tree,
          fs,
          dispatch: vi.fn(),
        }),
      { initialProps: { workspace: empty } },
    );
    await waitFor(() => expect(getFileContent).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });

    await changePastWriteDelay(() =>
      rerender({ workspace: { ...empty, openTabs: ["/b.md"], activeTabPath: "/b.md" } }),
    );
    await waitFor(() => expect(setFileContent).toHaveBeenCalled());
    expect(setFileContent.mock.calls.at(-1)?.[2]).toContain('"/b.md"');
    expect(getFileTree).not.toHaveBeenCalled();
  });

  it("writes again once a tab opened before its tree arrived is in the tree", async () => {
    const setFileContent = vi.fn<VaultFileSystemService["setFileContent"]>(async () => 1);
    const getFileContent = vi.fn(async () => null);
    const fs = stubFs({ setFileContent, getFileContent });
    const before: FileTreeNode = { name: "", type: "folder", children: [] };
    const after: FileTreeNode = {
      name: "",
      type: "folder",
      children: [{ name: "new.md", type: "file" }],
    };
    const opened = {
      ...createDefaultWorkspaceState(),
      openTabs: ["/new.md"],
      activeTabPath: "/new.md",
    };
    const { rerender } = renderHook(
      (props: { tree: FileTreeNode }) =>
        useWorkspacePersistence({
          vaultId: "notes",
          workspace: opened,
          tree: props.tree,
          fs,
          dispatch: vi.fn(),
        }),
      { initialProps: { tree: before } },
    );
    await waitFor(() => expect(getFileContent).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    setFileContent.mockClear();

    await changePastWriteDelay(() => rerender({ tree: after }));
    await waitFor(() => expect(setFileContent).toHaveBeenCalled());
    expect(setFileContent.mock.calls.at(-1)?.[2]).toContain('"/new.md"');
  });
});
