import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampCanonicalTreeSplitPercent,
  displayTreeSplitPercent,
  isTreeSplitDragCollapsed,
  percentFromDelta,
  persistableTreeSplitPercent,
  TREE_SPLIT_DEFAULT_PERCENT,
  TREE_SPLIT_MIN_PERCENT,
  type TreeSplitAxis,
  type VaultWorkspaceAction,
} from "@upriv/shared";

export interface UseTreeSplitDragOptions {
  /** `workspace.treeSplitPercent` of this vault; null uses the default. */
  savedPercent: number | null;
  /** File manager extent along `axis` in px (0 before the first layout). */
  containerSize: number;
  axis: TreeSplitAxis;
  dispatch: (action: VaultWorkspaceAction) => void;
  /**
   * Paints the explorer during a drag (visual %, 0 while collapsed; size frozen at grab).
   * When set, a move does not re-render; without it `percent` follows every move.
   */
  onDragFrame?: (visualPercent: number, size: number) => void;
}

export interface TreeSplitDrag {
  /** Canonical split % (4–65): saved, or live while a drag re-renders. */
  percent: number;
  /** Explorer % of the container for this axis; 0 while a drag holds it collapsed. */
  visualPercent: number;
  onDragStart: () => void;
  /** Pixel delta from the grab point. */
  onDrag: (deltaPx: number) => void;
  onDragEnd: () => void;
  /** Rounds, clamps, and saves a canonical % into the vault workspace. */
  commit: (canonicalPercent: number) => void;
  /** Calls `onDragFrame` again with the live drag (after a re-render reset the size). */
  repaintDrag: () => void;
}

interface DragStart {
  percent: number;
  size: number;
}

/**
 * Explorer/editor split shared by desktop and mobile. Releasing past half the
 * explorer's minimum size hides the explorer.
 */
export function useTreeSplitDrag({
  savedPercent,
  containerSize,
  axis,
  dispatch,
  onDragFrame,
}: UseTreeSplitDragOptions): TreeSplitDrag {
  const saved = clampCanonicalTreeSplitPercent(savedPercent ?? TREE_SPLIT_DEFAULT_PERCENT);
  const [percent, setPercentState] = useState(saved);
  const percentRef = useRef(saved);
  const [collapsed, setCollapsedState] = useState(false);
  const collapsedRef = useRef(false);
  const dragRef = useRef<DragStart | null>(null);
  const containerSizeRef = useRef(containerSize);
  containerSizeRef.current = containerSize;
  const onDragFrameRef = useRef(onDragFrame);
  onDragFrameRef.current = onDragFrame;

  const setPercent = useCallback((next: number) => {
    percentRef.current = next;
    setPercentState(next);
  }, []);

  const setCollapsed = useCallback((next: boolean) => {
    if (collapsedRef.current === next) return;
    collapsedRef.current = next;
    setCollapsedState(next);
  }, []);

  useEffect(() => {
    if (dragRef.current) return;
    setPercent(saved);
  }, [saved, setPercent]);

  const paint = useCallback(
    (drag: DragStart) => {
      const visual = collapsedRef.current
        ? 0
        : displayTreeSplitPercent(percentRef.current, drag.size, axis);
      onDragFrameRef.current?.(visual, drag.size);
    },
    [axis],
  );

  const commit = useCallback(
    (canonicalPercent: number) => {
      const next = persistableTreeSplitPercent(canonicalPercent);
      setPercent(next);
      dispatch({ type: "set_tree_split_percent", percent: next });
    },
    [dispatch, setPercent],
  );

  const onDragStart = useCallback(() => {
    dragRef.current = { percent: percentRef.current, size: containerSizeRef.current };
    setCollapsed(false);
  }, [setCollapsed]);

  const onDrag = useCallback(
    (deltaPx: number) => {
      const drag = dragRef.current;
      if (!drag || drag.size <= 0) return;
      setCollapsed(isTreeSplitDragCollapsed(drag.percent, deltaPx, drag.size, axis));
      if (!collapsedRef.current) {
        percentRef.current = percentFromDelta(drag.percent, deltaPx, drag.size, axis);
        if (!onDragFrameRef.current) setPercentState(percentRef.current);
      }
      paint(drag);
    },
    [axis, paint, setCollapsed],
  );

  const onDragEnd = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (collapsedRef.current) {
      setCollapsed(false);
      commit(TREE_SPLIT_MIN_PERCENT);
      dispatch({ type: "set_explorer_collapsed", collapsed: true });
      return;
    }
    commit(percentRef.current);
  }, [commit, dispatch, setCollapsed]);

  const repaintDrag = useCallback(() => {
    if (dragRef.current) paint(dragRef.current);
  }, [paint]);

  return {
    percent,
    visualPercent: collapsed ? 0 : displayTreeSplitPercent(percent, containerSize, axis),
    onDragStart,
    onDrag,
    onDragEnd,
    commit,
    repaintDrag,
  };
}
