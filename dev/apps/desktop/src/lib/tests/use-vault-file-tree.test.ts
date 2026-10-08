/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FileTreeNode } from "@upriv/shared";
import { useVaultFileTree } from "@upriv/shared/react";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function root(...names: string[]): FileTreeNode {
  return {
    name: "",
    type: "folder",
    children: names.map((name) => ({ name, type: "file" as const })),
  };
}

describe("useVaultFileTree", () => {
  it("is loading until the first tree arrives, then ready", async () => {
    const pending = deferred<FileTreeNode>();
    const fs = { getFileTree: () => pending.promise };
    const { result } = renderHook(() => useVaultFileTree(fs, "vault-a", 0));

    expect(result.current.status).toBe("loading");
    await act(async () => {
      pending.resolve(root("a.txt"));
    });
    expect(result.current.status).toBe("ready");
    expect(result.current.tree.children?.map((node) => node.name)).toEqual(["a.txt"]);
  });

  it("reports error and loads again on retry", async () => {
    const getFileTree = vi
      .fn<(vaultId: string) => Promise<FileTreeNode>>()
      .mockRejectedValueOnce(new Error("rpc down"))
      .mockResolvedValueOnce(root("b.txt"));
    const fs = { getFileTree };
    const { result } = renderHook(() => useVaultFileTree(fs, "vault-a", 0));

    await waitFor(() => expect(result.current.status).toBe("error"));
    act(() => result.current.retry());
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.tree.children?.map((node) => node.name)).toEqual(["b.txt"]);
  });

  it("keeps the current tree ready while a revision refetch is in flight", async () => {
    const refetch = deferred<FileTreeNode>();
    const getFileTree = vi
      .fn<(vaultId: string) => Promise<FileTreeNode>>()
      .mockResolvedValueOnce(root("a.txt"))
      .mockReturnValueOnce(refetch.promise);
    const fs = { getFileTree };
    const { result, rerender } = renderHook(
      ({ revision }: { revision: number }) => useVaultFileTree(fs, "vault-a", revision),
      { initialProps: { revision: 0 } },
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ revision: 1 });
    expect(result.current.status).toBe("ready");
    expect(result.current.tree.children?.map((node) => node.name)).toEqual(["a.txt"]);
    await act(async () => {
      refetch.resolve(root("a.txt", "c.txt"));
    });
    expect(result.current.tree.children?.map((node) => node.name)).toEqual(["a.txt", "c.txt"]);
  });

  it("keeps the current tree when a revision refetch fails", async () => {
    const getFileTree = vi
      .fn<(vaultId: string) => Promise<FileTreeNode>>()
      .mockResolvedValueOnce(root("a.txt"))
      .mockRejectedValueOnce(new Error("rpc down"));
    const fs = { getFileTree };
    const { result, rerender } = renderHook(
      ({ revision }: { revision: number }) => useVaultFileTree(fs, "vault-a", revision),
      { initialProps: { revision: 0 } },
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ revision: 1 });
    await waitFor(() => expect(getFileTree).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(result.current.status).toBe("ready");
    expect(result.current.tree.children?.map((node) => node.name)).toEqual(["a.txt"]);
  });

  it("goes back to loading when the vault changes", async () => {
    const second = deferred<FileTreeNode>();
    const getFileTree = vi
      .fn<(vaultId: string) => Promise<FileTreeNode>>()
      .mockResolvedValueOnce(root("a.txt"))
      .mockReturnValueOnce(second.promise);
    const fs = { getFileTree };
    const { result, rerender } = renderHook(
      ({ vaultId }: { vaultId: string }) => useVaultFileTree(fs, vaultId, 0),
      { initialProps: { vaultId: "vault-a" } },
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ vaultId: "vault-b" });
    expect(result.current.status).toBe("loading");
    await act(async () => {
      second.resolve(root("z.txt"));
    });
    expect(result.current.status).toBe("ready");
  });
});
