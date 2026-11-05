import { useCallback, useRef } from "react";
import {
  clampOutlineWidth,
  displayOutlineWidth,
  isOutlineDragCollapsed,
  outlineWidthFromDrag,
  persistableOutlineWidth,
} from "../domain";

/** What a drag needs to know when it starts. */
export interface OutlineWidthMeasure {
  /** The outline's drawn width: the default has no number of its own. */
  outline: number;
  /** The row the note and its outline share. */
  row: number;
}

export interface UseOutlineWidthDragOptions {
  /** This note's saved outline width; null draws the platform default. */
  savedWidth: number | null;
  measure: () => OutlineWidthMeasure;
  /** Paints the outline during a drag without a render; `null` while the drag would close it. */
  onDragFrame: (width: number | null) => void;
  /** Saves a width for this note. */
  onCommit: (width: number) => void;
  /** A release past the collapse point closes the outline and keeps the width it had. */
  onCollapse: () => void;
}

export interface OutlineWidthDrag {
  /**
   * Width to draw, or null for the platform default. The row share
   * (`OUTLINE_MAX_ROW_SHARE`) caps it as a max width in the layout.
   */
  width: number | null;
  onDragStart: () => void;
  /** Pixel delta from the grab point. */
  onDrag: (deltaPx: number) => void;
  onDragEnd: () => void;
  /** Saves a width chosen without a drag (arrow keys), within the row. */
  commit: (width: number) => void;
}

interface DragState {
  startWidth: number;
  rowWidth: number;
  /** Live width, or null while the drag would close the outline. */
  width: number | null;
}

/**
 * Divider between a note and its outline, shared by desktop and mobile. Same
 * feel as the explorer's: the divider stays under the pointer, and a release
 * near the right edge closes the outline.
 */
export function useOutlineWidthDrag({
  savedWidth,
  measure,
  onDragFrame,
  onCommit,
  onCollapse,
}: UseOutlineWidthDragOptions): OutlineWidthDrag {
  const dragRef = useRef<DragState | null>(null);
  const latest = useRef({ measure, onDragFrame, onCommit, onCollapse });
  latest.current = { measure, onDragFrame, onCommit, onCollapse };

  const commit = useCallback((width: number) => {
    const { row } = latest.current.measure();
    latest.current.onCommit(persistableOutlineWidth(displayOutlineWidth(width, row)));
  }, []);

  const onDragStart = useCallback(() => {
    const { outline, row } = latest.current.measure();
    dragRef.current = { startWidth: outline, rowWidth: row, width: outline };
  }, []);

  const onDrag = useCallback((deltaPx: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.width = isOutlineDragCollapsed(drag.startWidth, deltaPx)
      ? null
      : outlineWidthFromDrag(drag.startWidth, deltaPx, drag.rowWidth);
    latest.current.onDragFrame(drag.width);
  }, []);

  const onDragEnd = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const { onDragFrame: paint, onCommit: save, onCollapse: collapse } = latest.current;
    if (drag.width === null) {
      paint(drag.startWidth);
      collapse();
      return;
    }
    const saved = persistableOutlineWidth(drag.width);
    // A render that keeps the same width changes nothing, so the rounded width is painted here.
    paint(saved);
    save(saved);
  }, []);

  return {
    width: savedWidth === null ? null : clampOutlineWidth(savedWidth),
    onDragStart,
    onDrag,
    onDragEnd,
    commit,
  };
}
