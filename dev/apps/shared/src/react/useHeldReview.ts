import { useCallback, useEffect, useState } from "react";
import type { HeldFileItem } from "../domain";
import type { VaultHeld } from "./useVaultHeld";

/** A delete waiting for its confirmation: one set-aside file, or every piece. */
export type HeldDeleteAsk = { kind: "file"; item: HeldFileItem } | { kind: "pieces" };

export interface HeldReview {
  /** The delete the window asks to confirm, in place of its Close button. */
  asking: HeldDeleteAsk | null;
  askDeleteFile: (item: HeldFileItem) => void;
  askDeletePieces: () => void;
  cancelDelete: () => void;
  /** Delete what `asking` names, for good. */
  confirmDelete: () => void;
  /** Put a file back; `onPutBack` hears where it is now. */
  putBack: (item: HeldFileItem) => void;
  /** A put back or delete of a piece is running. */
  piecesWorking: boolean;
}

/**
 * The review window of set-aside data, the same on every platform. Delete
 * does nothing until the window's own confirmation, as every permanent delete
 * of the app asks: a double click on a row cannot delete for good. The
 * question goes away when the window closes or its target is gone.
 */
export function useHeldReview(held: VaultHeld, onPutBack: (path: string) => void): HeldReview {
  const [asking, setAsking] = useState<HeldDeleteAsk | null>(null);
  const { summary, open, working, restore, remove } = held;

  useEffect(() => {
    if (!open) setAsking(null);
  }, [open]);

  useEffect(() => {
    setAsking((current) => {
      if (current?.kind === "file" && !summary?.files.some((f) => f.name === current.item.name)) {
        return null;
      }
      if (current?.kind === "pieces" && !summary?.pieces.length) return null;
      return current;
    });
  }, [summary]);

  const putBack = useCallback(
    (item: HeldFileItem) => {
      setAsking(null);
      void restore([item.name]).then((paths) => {
        const path = paths?.[0];
        if (path) onPutBack(path);
      });
    },
    [onPutBack, restore],
  );

  const confirmDelete = useCallback(() => {
    if (!asking) return;
    setAsking(null);
    const names =
      asking.kind === "file"
        ? [asking.item.name]
        : (summary?.pieces.map((piece) => piece.name) ?? []);
    if (names.length > 0) void remove(names);
  }, [asking, remove, summary]);

  return {
    asking,
    askDeleteFile: useCallback((item) => setAsking({ kind: "file", item }), []),
    askDeletePieces: useCallback(() => setAsking({ kind: "pieces" }), []),
    cancelDelete: useCallback(() => setAsking(null), []),
    confirmDelete,
    putBack,
    piecesWorking: summary?.pieces.some((piece) => working.has(piece.name)) ?? false,
  };
}
