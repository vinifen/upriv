/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DragEvent } from "react";
import { useVaultImportDrop } from "../useVaultImportDrop";
import type { VaultListDropSource } from "../../lib/vaultImportDrop";

function dropEvent(file: File): DragEvent {
  return {
    preventDefault() {},
    stopPropagation() {},
    dataTransfer: {
      types: ["Files"],
      items: [],
      files: [file],
      getData: () => "",
      dropEffect: "none",
    },
  } as unknown as DragEvent;
}

describe("useVaultImportDrop", () => {
  afterEach(() => {
    delete window.upriv;
  });

  it("opens create-vault with the dropped file once its path is classified", async () => {
    window.upriv = {
      getPathForFile: () => "/tmp/notes.txt",
      classifyDroppedPath: async () => "file",
    } as unknown as Window["upriv"];
    const onAccept = vi.fn();
    const { result } = renderHook(() =>
      useVaultImportDrop({ enabled: true, onAcceptImportPackage: onAccept }),
    );

    act(() => {
      result.current.onDrop(dropEvent(new File([], "notes.txt")));
    });

    await waitFor(() => {
      expect(onAccept).toHaveBeenCalledWith({
        fileName: "notes.txt",
        absolutePath: "/tmp/notes.txt",
        shape: "file",
      } satisfies VaultListDropSource);
    });
  });

  it("ignores a classification that finishes after the drop target is disabled", async () => {
    let finish: (kind: "file" | "directory" | "other") => void = () => {};
    window.upriv = {
      getPathForFile: () => "/tmp/notes.txt",
      classifyDroppedPath: () =>
        new Promise<"file" | "directory" | "other">((resolve) => {
          finish = resolve;
        }),
    } as unknown as Window["upriv"];
    const onAccept = vi.fn();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useVaultImportDrop({ enabled, onAcceptImportPackage: onAccept }),
      { initialProps: { enabled: true } },
    );

    act(() => {
      result.current.onDrop(dropEvent(new File([], "notes.txt")));
    });
    rerender({ enabled: false });
    await act(async () => {
      finish("directory");
      await Promise.resolve();
    });

    expect(onAccept).not.toHaveBeenCalled();
  });
});
