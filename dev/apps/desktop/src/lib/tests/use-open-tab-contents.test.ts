/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  createDefaultWorkspaceState,
  FilePreviewTooLargeError,
  TAB_CONTENT_CACHE_CHARS,
  type VaultFileContent,
  type VaultWorkspaceState,
} from "@upriv/shared";
import { useOpenTabContents } from "@upriv/shared/react";

const NO_IMPORTS: ReadonlySet<string> = new Set();

function workspaceWith(patch: Partial<VaultWorkspaceState>): VaultWorkspaceState {
  return { ...createDefaultWorkspaceState(), ...patch };
}

function fsReading(read: (path: string) => Promise<VaultFileContent | null>, ramFree = true) {
  const getFileContent = vi.fn((_vaultId: string, path: string) => read(path));
  const previewFits = vi.fn(async () => ramFree);
  return { getFileContent, previewFits, isFileViewable: () => true };
}

function renderContents(
  fs: ReturnType<typeof fsReading>,
  workspace: VaultWorkspaceState,
  onReadFailed = vi.fn(),
) {
  const view = renderHook(
    (props: { workspace: VaultWorkspaceState; imports: ReadonlySet<string> }) =>
      useOpenTabContents({
        fs,
        vaultId: "notes",
        workspace: props.workspace,
        unresolvedImportPaths: props.imports,
        onReadFailed,
      }),
    { initialProps: { workspace, imports: NO_IMPORTS } },
  );
  return { ...view, onReadFailed };
}

const text = (content: string): VaultFileContent => ({ language: "text", content });

describe("useOpenTabContents", () => {
  it("reads the tab on screen, and a tab shown before is not read again", async () => {
    const fs = fsReading(async (path) => text(`text of ${path}`));
    const open = { openTabs: ["/a.md", "/b.md", "/c.md"] };
    const { result, rerender } = renderContents(
      fs,
      workspaceWith({ ...open, activeTabPath: "/c.md" }),
    );
    await waitFor(() => expect(result.current.contents["/c.md"]?.state).toBe("loaded"));
    expect(fs.getFileContent.mock.calls.map((call) => call[1])).toEqual(["/c.md"]);

    rerender({
      workspace: workspaceWith({ ...open, activeTabPath: "/a.md" }),
      imports: NO_IMPORTS,
    });
    await waitFor(() => expect(result.current.contents["/a.md"]?.state).toBe("loaded"));
    rerender({
      workspace: workspaceWith({ ...open, activeTabPath: "/c.md" }),
      imports: NO_IMPORTS,
    });
    expect(fs.getFileContent.mock.calls.map((call) => call[1])).toEqual(["/c.md", "/a.md"]);
  });

  it("reads the tab again after the tree changes and keeps the old text until then", async () => {
    let next = "one";
    let release: () => void = () => undefined;
    const fs = fsReading(
      (path) =>
        new Promise((resolve) => {
          const content = next;
          release = () => resolve(text(`${path}:${content}`));
        }),
    );
    const base = { openTabs: ["/a.md"], activeTabPath: "/a.md" };
    const { result, rerender } = renderContents(fs, workspaceWith(base));
    await act(async () => undefined);
    await act(async () => release());
    expect(result.current.contents["/a.md"]).toMatchObject({ text: "/a.md:one" });

    next = "two";
    rerender({ workspace: workspaceWith({ ...base, treeRevision: 1 }), imports: NO_IMPORTS });
    expect(result.current.contents["/a.md"]).toMatchObject({ text: "/a.md:one" });
    await act(async () => release());
    expect(result.current.contents["/a.md"]).toMatchObject({ text: "/a.md:two", revision: 1 });
  });

  it("drops a read that lands after its tab was left when it does not fit", async () => {
    const releases = new Map<string, () => void>();
    const fs = fsReading(
      (path) =>
        new Promise((resolve) => {
          const content = path === "/big.md" ? "x".repeat(TAB_CONTENT_CACHE_CHARS + 1) : path;
          releases.set(path, () => resolve(text(content)));
        }),
    );
    const open = { openTabs: ["/big.md", "/small.md"] };
    const { result, rerender } = renderContents(
      fs,
      workspaceWith({ ...open, activeTabPath: "/big.md" }),
    );
    rerender({
      workspace: workspaceWith({ ...open, activeTabPath: "/small.md" }),
      imports: NO_IMPORTS,
    });
    await act(async () => undefined);
    await act(async () => releases.get("/small.md")?.());
    await act(async () => releases.get("/big.md")?.());

    expect(result.current.contents["/small.md"]?.state).toBe("loaded");
    expect(result.current.contents["/big.md"]).toBeUndefined();
  });

  it("drops the text of a tab that closed", async () => {
    const fs = fsReading(async (path) => text(path));
    const { result, rerender } = renderContents(
      fs,
      workspaceWith({ openTabs: ["/a.md", "/b.md"], activeTabPath: "/a.md" }),
    );
    await waitFor(() => expect(result.current.contents["/a.md"]).toBeDefined());
    rerender({
      workspace: workspaceWith({ openTabs: ["/b.md"], activeTabPath: "/b.md" }),
      imports: NO_IMPORTS,
    });
    await waitFor(() => expect(result.current.contents["/b.md"]).toBeDefined());
    expect(result.current.contents["/a.md"]).toBeUndefined();
  });

  it("marks a tab it cannot read and says so once", async () => {
    const fs = fsReading(async () => {
      throw new Error("read failed");
    });
    const { result, onReadFailed } = renderContents(
      fs,
      workspaceWith({ openTabs: ["/a.md"], activeTabPath: "/a.md" }),
    );
    await waitFor(() => expect(result.current.contents["/a.md"]?.state).toBe("failed"));
    expect(onReadFailed).toHaveBeenCalledTimes(1);
  });

  it("does not read a file past the preview cap again after the tree changes", async () => {
    const fs = fsReading(async () => {
      throw new FilePreviewTooLargeError();
    });
    const base = { openTabs: ["/big.txt"], activeTabPath: "/big.txt" };
    const { result, rerender } = renderContents(fs, workspaceWith(base));
    await waitFor(() => expect(result.current.contents["/big.txt"]?.state).toBe("too_large"));
    rerender({ workspace: workspaceWith({ ...base, treeRevision: 3 }), imports: NO_IMPORTS });
    await act(async () => undefined);
    expect(fs.getFileContent).toHaveBeenCalledTimes(1);
  });

  it("does not read a file free RAM cannot hold", async () => {
    const fs = fsReading(async (path) => text(path), false);
    const workspace = workspaceWith({ openTabs: ["/big.md"], activeTabPath: "/big.md" });
    const { result } = renderHook(() =>
      useOpenTabContents({
        fs,
        vaultId: "notes",
        workspace,
        unresolvedImportPaths: NO_IMPORTS,
        onReadFailed: () => undefined,
      }),
    );
    await waitFor(() => expect(result.current.contents["/big.md"]?.state).toBe("too_large"));
    expect(fs.getFileContent).not.toHaveBeenCalled();
  });

  it("keeps reading a tab already on screen when RAM runs short", async () => {
    const fs = fsReading(async (path) => text(path));
    const open = workspaceWith({ openTabs: ["/a.md"], activeTabPath: "/a.md", treeRevision: 1 });
    const { result, rerender } = renderHook(
      (props: { workspace: VaultWorkspaceState }) =>
        useOpenTabContents({
          fs,
          vaultId: "notes",
          workspace: props.workspace,
          unresolvedImportPaths: NO_IMPORTS,
          onReadFailed: () => undefined,
        }),
      { initialProps: { workspace: open } },
    );
    await waitFor(() => expect(result.current.contents["/a.md"]?.state).toBe("loaded"));

    fs.previewFits.mockResolvedValue(false);
    rerender({ workspace: { ...open, treeRevision: 2 } });
    await waitFor(() => expect(fs.getFileContent).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.contents["/a.md"]?.revision).toBe(2));
    expect(result.current.contents["/a.md"]?.state).toBe("loaded");
    expect(fs.previewFits).toHaveBeenCalledTimes(1);
  });

  it("reads an imported tab once its file lands", async () => {
    const fs = fsReading(async (path) => text(path));
    const workspace = workspaceWith({ openTabs: ["/new.md"], activeTabPath: "/new.md" });
    const { result, rerender } = renderHook(
      (props: { imports: ReadonlySet<string> }) =>
        useOpenTabContents({
          fs,
          vaultId: "notes",
          workspace,
          unresolvedImportPaths: props.imports,
          onReadFailed: () => undefined,
        }),
      { initialProps: { imports: new Set(["/new.md"]) as ReadonlySet<string> } },
    );
    await act(async () => undefined);
    expect(fs.getFileContent).not.toHaveBeenCalled();

    rerender({ imports: NO_IMPORTS });
    await waitFor(() => expect(result.current.contents["/new.md"]?.state).toBe("loaded"));
  });

  it("keeps the text a save wrote", async () => {
    const fs = fsReading(async () => text("disk"));
    const { result } = renderContents(
      fs,
      workspaceWith({ openTabs: ["/a.md"], activeTabPath: "/a.md" }),
    );
    await waitFor(() => expect(result.current.contents["/a.md"]?.state).toBe("loaded"));
    act(() => result.current.storeSavedText("/a.md", "saved"));
    expect(result.current.contentOf("/a.md")).toMatchObject({ state: "loaded", text: "saved" });
  });
});
