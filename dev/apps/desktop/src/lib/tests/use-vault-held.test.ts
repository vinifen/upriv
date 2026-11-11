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

  it("asks core once when a put back is pressed twice before the answer", async () => {
    const { result, fs } = renderHeld([FILE]);
    await waitFor(() => expect(result.current.held.summary).not.toBeNull());
    await act(async () => {
      await Promise.all([
        result.current.held.restore(["a.blob"]),
        result.current.held.restore(["a.blob"]),
      ]);
    });
    expect(fs.restoreHeld).toHaveBeenCalledTimes(1);
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

const SECOND: HeldFileItem = {
  name: "c.blob",
  size: 90,
  heldAt: 1,
  file: { path: "/c.txt", size: 50, modifiedAt: 1, currentModifiedAt: null },
};

describe("useHeldReview", () => {
  it("deletes only after the window's own confirmation", async () => {
    const { result, fs } = renderHeld([FILE, PIECE]);
    await waitFor(() => expect(result.current.held.summary).not.toBeNull());
    act(() => result.current.held.show(true));

    // Two presses on the row's Delete only ask.
    act(() => result.current.review.askDelete(["a.blob"]));
    act(() => result.current.review.askDelete(["a.blob"]));
    expect(fs.deleteHeld).not.toHaveBeenCalled();
    expect(result.current.review.asking).toEqual({
      names: ["a.blob"],
      files: 1,
      bytes: 300,
      onlyPath: "/a.txt",
    });

    act(() => result.current.review.cancelDelete());
    expect(result.current.review.asking).toBeNull();

    act(() => result.current.review.askDelete(["b.blob"]));
    await act(async () => {
      result.current.review.confirmDelete();
    });
    expect(fs.deleteHeld).toHaveBeenCalledWith("notes", ["b.blob"]);
    expect(result.current.review.asking).toBeNull();
  });

  it("puts back every chosen file at once, and deletes every chosen item", async () => {
    const { result, fs, onPutBack } = renderHeld([FILE, SECOND, PIECE]);
    await waitFor(() => expect(result.current.held.summary?.files).toHaveLength(2));
    act(() => result.current.held.show(true));

    act(() => result.current.review.toggleAll());
    expect(result.current.review.allSelected).toBe(true);
    // A piece cannot be put back: Put back takes only the files.
    expect(result.current.review.selectedFiles).toEqual(["a.blob", "c.blob"]);
    await act(async () => {
      result.current.review.putBack(result.current.review.selectedFiles);
    });
    expect(fs.restoreHeld).toHaveBeenCalledWith("notes", ["a.blob", "c.blob"]);
    await waitFor(() => expect(onPutBack).toHaveBeenCalledWith(["/a.txt", "/a.txt"]));
    await waitFor(() => expect(result.current.review.items).toHaveLength(1));
    expect([...result.current.review.selected]).toEqual(["b.blob"]);

    act(() => result.current.review.askDelete([...result.current.review.selected]));
    expect(result.current.review.asking).toMatchObject({ names: ["b.blob"], files: 0 });
    await act(async () => {
      result.current.review.confirmDelete();
    });
    expect(fs.deleteHeld).toHaveBeenCalledWith("notes", ["b.blob"]);
  });

  it("drops the choice and the question when the window closes or an item is gone", async () => {
    const { result } = renderHeld([FILE, PIECE]);
    await waitFor(() => expect(result.current.held.summary).not.toBeNull());
    act(() => result.current.held.show(true));
    act(() => result.current.review.toggle("a.blob"));
    act(() => result.current.review.askDelete(["a.blob"]));
    act(() => result.current.held.show(false));
    expect(result.current.review.asking).toBeNull();
    expect(result.current.review.selected.size).toBe(0);

    act(() => result.current.held.show(true));
    act(() => result.current.review.askDelete(["a.blob", "b.blob"]));
    await act(async () => {
      await result.current.held.restore(["a.blob"]);
    });
    // The file went back: the question keeps only the piece.
    await waitFor(() =>
      expect(result.current.review.asking).toMatchObject({ names: ["b.blob"], files: 0 }),
    );
  });
});
