import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HeldItem } from "../domain";
import type { VaultHeld } from "./useVaultHeld";

/** A delete waiting for the window's confirmation. */
export interface HeldDeleteAsk {
  names: readonly string[];
  /** How many of them hold a file; the rest are pieces. */
  files: number;
  /** Bytes they take on disk. */
  bytes: number;
  /** The file's path when it is the only item. */
  onlyPath: string | null;
}

export interface HeldReview {
  /** Every item the window lists: the files, then the pieces. */
  items: readonly HeldItem[];
  /** Names of the chosen items. */
  selected: ReadonlySet<string>;
  toggle: (name: string) => void;
  /** Choose every item, or none when every one is chosen. */
  toggleAll: () => void;
  allSelected: boolean;
  /** The chosen items that hold a file: what Put back takes. */
  selectedFiles: readonly string[];
  /** The delete the window asks to confirm. */
  asking: HeldDeleteAsk | null;
  askDelete: (names: readonly string[]) => void;
  cancelDelete: () => void;
  /** Delete what `asking` names, for good. */
  confirmDelete: () => void;
  /** Put these files back; `onPutBack` hears where they are now. */
  putBack: (names: readonly string[]) => void;
}

/**
 * The review window of set-aside data, the same on every platform, laid out
 * like the Backups window: items can be chosen one by one or all at once, and
 * Put back or Delete acts on the chosen ones or on one row. Delete does
 * nothing until the window's own confirmation, as every permanent delete of
 * the app asks. The choice and the question go away when the window closes,
 * and an item that is gone leaves both.
 */
export function useHeldReview(
  held: VaultHeld,
  onPutBack: (paths: readonly string[]) => void,
): HeldReview {
  const { summary, open, restore, remove } = held;
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [asking, setAsking] = useState<HeldDeleteAsk | null>(null);

  const items = useMemo<readonly HeldItem[]>(
    () => (summary ? [...summary.files, ...summary.pieces] : []),
    [summary],
  );
  const byName = useMemo(() => new Map(items.map((item) => [item.name, item])), [items]);

  useEffect(() => {
    if (open) return;
    setSelected(new Set());
    setAsking(null);
  }, [open]);

  useEffect(() => {
    setSelected((current) => {
      const kept = [...current].filter((name) => byName.has(name));
      return kept.length === current.size ? current : new Set(kept);
    });
    setAsking((current) => {
      if (!current) return current;
      const kept = current.names.filter((name) => byName.has(name));
      if (kept.length === current.names.length) return current;
      return kept.length > 0 ? deleteAsk(kept, byName) : null;
    });
  }, [byName]);

  const toggle = useCallback((name: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const allSelected = items.length > 0 && items.every((item) => selected.has(item.name));
  const toggleAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(items.map((item) => item.name)));
  }, [allSelected, items]);

  const forget = useCallback((names: readonly string[]) => {
    setSelected((current) => new Set([...current].filter((name) => !names.includes(name))));
  }, []);

  // Read when a put back lands, so `putBack` stays the same between renders.
  const onPutBackRef = useRef(onPutBack);
  onPutBackRef.current = onPutBack;
  const putBack = useCallback(
    (names: readonly string[]) => {
      const files = names.filter((name) => byName.get(name)?.file);
      if (files.length === 0) return;
      setAsking(null);
      void restore(files).then((paths) => {
        if (!paths) return;
        forget(files);
        if (paths.length > 0) onPutBackRef.current(paths);
      });
    },
    [byName, forget, restore],
  );

  const askDelete = useCallback(
    (names: readonly string[]) => {
      const known = names.filter((name) => byName.has(name));
      setAsking(known.length > 0 ? deleteAsk(known, byName) : null);
    },
    [byName],
  );

  const confirmDelete = useCallback(() => {
    if (!asking) return;
    const { names } = asking;
    setAsking(null);
    void remove([...names]).then((deleted) => {
      if (deleted) forget(names);
    });
  }, [asking, forget, remove]);

  return {
    items,
    selected,
    toggle,
    toggleAll,
    allSelected,
    selectedFiles: items
      .filter((item) => item.file && selected.has(item.name))
      .map((item) => item.name),
    asking,
    askDelete,
    cancelDelete: useCallback(() => setAsking(null), []),
    confirmDelete,
    putBack,
  };
}

function deleteAsk(names: readonly string[], byName: ReadonlyMap<string, HeldItem>): HeldDeleteAsk {
  const chosen = names.flatMap((name) => byName.get(name) ?? []);
  const only = chosen.length === 1 ? chosen[0] : undefined;
  return {
    names,
    files: chosen.filter((item) => item.file).length,
    bytes: chosen.reduce((sum, item) => sum + item.size, 0),
    onlyPath: only?.file?.path ?? null,
  };
}
