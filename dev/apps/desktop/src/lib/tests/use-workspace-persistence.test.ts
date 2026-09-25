/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  createDefaultWorkspaceState,
  serializeWorkspaceSnapshot,
  workspaceSnapshotFromState,
  type VaultFileSystemService,
  type VaultWorkspaceAction,
  type VaultWorkspaceState,
} from "@upriv/shared";
import { useWorkspacePersistence } from "@upriv/shared/react";

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
    languageFromPath: () => "text",
    ...overrides,
  };
}

function hydrateCalls(dispatch: { mock: { calls: unknown[][] } }): VaultWorkspaceAction[] {
  return dispatch.mock.calls
    .map((call) => call[0] as VaultWorkspaceAction)
    .filter((action) => action.type === "hydrate_persisted");
}

describe("useWorkspacePersistence", () => {
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
    renderHook(() => useWorkspacePersistence({ vaultId: "notes", workspace: empty, fs, dispatch }));

    await waitFor(() => {
      expect(hydrateCalls(dispatch)).toHaveLength(1);
    });
    expect(hydrateCalls(dispatch)[0]).toMatchObject({
      type: "hydrate_persisted",
      openTabs: ["/a.md"],
      activeTabPath: "/a.md",
    });
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

    rerender({
      workspace: { ...empty, dropTargetPath: "/photos", expandedPaths: ["/", "/photos"] },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(setFileContent).not.toHaveBeenCalled();

    rerender({
      workspace: { ...empty, dropTargetPath: null, expandedPaths: ["/", "/photos"] },
    });
    await waitFor(() => expect(setFileContent).toHaveBeenCalled());
  });
});
