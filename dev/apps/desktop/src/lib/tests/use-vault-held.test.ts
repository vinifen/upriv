/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RpcError, VAULT_ERROR_CODES, type HeldFileItem, type HeldItem } from "@upriv/shared";
import { useHeldReview, useVaultHeld } from "@upriv/shared/react";

const FILE: HeldFileItem = {
  name: "a.blob",
  size: 300,
  heldAt: 1,
  file: { path: "/a.txt", size: 6, modifiedAt: 1, currentModifiedAt: null },
};
const PIECE: HeldItem = { name: "b.blob", size: 64, heldAt: 1, file: null };

function renderHeld(items: HeldItem[]) {
  let held = items;
  const fs = {
    getHeld: vi.fn(async () => held),
    restoreHeld: vi.fn(async (_id: string, names: string[]) => {
      held = held.filter((item) => !names.includes(item.name));
      return { paths: names.map(() => "/a.txt"), revision: 7 };
    }),
    deleteHeld: vi.fn(async (_id: string, names: string[]) => {
      held = held.filter((item) => !names.includes(item.name));
      return 8;
    }),
  };
  const report = { mutated: vi.fn(), synced: vi.fn(async () => undefined), failed: vi.fn() };
  const onPutBack = vi.fn();
  const view = renderHook(() => {
    const held = useVaultHeld(fs, "notes", report);
    const review = useHeldReview(held, onPutBack);
    return { held, review };
  });
  return { ...view, fs, report, onPutBack };
}

describe("useVaultHeld", () => {
  it("is empty while nothing is set aside", async () => {
    const { result, fs } = renderHeld([]);
    await waitFor(() => expect(fs.getHeld).toHaveBeenCalled());
    expect(result.current.held.summary).toBeNull();
  });

  it("reads the list when the vault opens, when the review opens, and after a change", async () => {
    const { result, fs, report } = renderHeld([FILE, PIECE]);
    await waitFor(() => expect(result.current.held.summary?.files).toHaveLength(1));
    expect(fs.getHeld).toHaveBeenCalledTimes(1);
    act(() => result.current.held.show(true));
    await waitFor(() => expect(fs.getHeld).toHaveBeenCalledTimes(2));
    expect(result.current.held.open).toBe(true);

    let paths: string[] | null = null;
    await act(async () => {
      paths = await result.current.held.restore(["a.blob"]);
    });
    expect(paths).toEqual(["/a.txt"]);
    // The revision core answered with: no second call to ask for it.
    expect(report.mutated).toHaveBeenCalledWith(7);
    expect(report.synced).not.toHaveBeenCalled();
    expect(result.current.held.working.size).toBe(0);
    await waitFor(() => expect(result.current.held.summary?.files).toHaveLength(0));
    expect(fs.getHeld).toHaveBeenCalledTimes(3);
    expect(result.current.held.summary?.pieces).toHaveLength(1);
  });

  it("reports a failure and asks core for the revision", async () => {
    const { result, report, fs } = renderHeld([PIECE]);
    await waitFor(() => expect(result.current.held.summary).not.toBeNull());
    fs.deleteHeld.mockRejectedValueOnce(new RpcError(VAULT_ERROR_CODES.HELD_NOT_FOUND, "gone"));
    let deleted = true;
    await act(async () => {
      deleted = await result.current.held.remove(["b.blob"]);
    });
    expect(deleted).toBe(false);
    expect(report.failed).toHaveBeenCalledTimes(1);
    expect(report.synced).toHaveBeenCalledTimes(1);
    expect(report.mutated).not.toHaveBeenCalled();
  });

  it("closes the review once nothing is left", async () => {
    const { result } = renderHeld([FILE]);
    await waitFor(() => expect(result.current.held.summary).not.toBeNull());
    act(() => result.current.held.show(true));
    await act(async () => {
      await result.current.held.restore(["a.blob"]);
    });
    await waitFor(() => expect(result.current.held.summary).toBeNull());
    expect(result.current.held.open).toBe(false);
  });
});

describe("useHeldReview", () => {
  it("deletes only after the window's own confirmation", async () => {
    const { result, fs } = renderHeld([FILE, PIECE]);
    await waitFor(() => expect(result.current.held.summary).not.toBeNull());
    act(() => result.current.held.show(true));

    // Two presses on the row's Delete only ask.
    act(() => result.current.review.askDeleteFile(FILE));
    act(() => result.current.review.askDeleteFile(FILE));
    expect(fs.deleteHeld).not.toHaveBeenCalled();
    expect(result.current.review.asking).toEqual({ kind: "file", item: FILE });

    act(() => result.current.review.cancelDelete());
    expect(result.current.review.asking).toBeNull();

    act(() => result.current.review.askDeletePieces());
    await act(async () => {
      result.current.review.confirmDelete();
    });
    expect(fs.deleteHeld).toHaveBeenCalledWith("notes", ["b.blob"]);
    expect(result.current.review.asking).toBeNull();
  });

  it("drops the question when the window closes or its file is gone", async () => {
    const { result, onPutBack } = renderHeld([FILE, PIECE]);
    await waitFor(() => expect(result.current.held.summary).not.toBeNull());
    act(() => result.current.held.show(true));
    act(() => result.current.review.askDeleteFile(FILE));
    act(() => result.current.held.show(false));
    expect(result.current.review.asking).toBeNull();

    act(() => result.current.held.show(true));
    act(() => result.current.review.askDeletePieces());
    await act(async () => {
      result.current.review.putBack(FILE);
    });
    await waitFor(() => expect(onPutBack).toHaveBeenCalledWith("/a.txt"));
    expect(result.current.review.asking).toBeNull();
  });
});
