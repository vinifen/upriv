export const TREE_SPLIT_DEFAULT_PERCENT = 20;
export const TREE_SPLIT_MIN_PERCENT = 4;
export const TREE_SPLIT_MAX_PERCENT = 65;
/** Floor for the row (side-by-side) explorer width — display only; never stored. Column has none. */
const TREE_SPLIT_ROW_MIN_PX = 64;
/** Share of the visual minimum below which a drag hides the explorer. */
const TREE_SPLIT_COLLAPSE_RATIO = 0.5;

const CANONICAL_SPAN = TREE_SPLIT_MAX_PERCENT - TREE_SPLIT_MIN_PERCENT;

export type TreeSplitAxis = "x" | "y";

/** Visual min % for the current axis/container (above 4 % on narrow rows). */
function visualMinPercent(containerSize: number, axis: TreeSplitAxis): number {
  if (axis === "y" || containerSize <= 0) return TREE_SPLIT_MIN_PERCENT;
  return Math.max(TREE_SPLIT_MIN_PERCENT, (TREE_SPLIT_ROW_MIN_PX / containerSize) * 100);
}

/** Collapse threshold in pixels below which the explorer snaps shut. */
export function treeSplitCollapseThresholdPx(
  containerSize: number,
  axis: TreeSplitAxis = "x",
): number {
  if (containerSize <= 0) return 0;
  const visualMinPx = (visualMinPercent(containerSize, axis) / 100) * containerSize;
  return visualMinPx * TREE_SPLIT_COLLAPSE_RATIO;
}

/** Whether a drag delta from the grab point moves the divider past the collapse threshold. */
export function isTreeSplitDragCollapsed(
  startCanonicalPercent: number,
  deltaPx: number,
  containerSize: number,
  axis: TreeSplitAxis = "x",
): boolean {
  if (containerSize <= 0) return false;
  const startPx =
    (displayTreeSplitPercent(startCanonicalPercent, containerSize, axis) / 100) * containerSize;
  return startPx + deltaPx <= treeSplitCollapseThresholdPx(containerSize, axis);
}

/** Clamp into the canonical range [4, 65]. */
export function clampCanonicalTreeSplitPercent(percent: number): number {
  return Math.min(TREE_SPLIT_MAX_PERCENT, Math.max(TREE_SPLIT_MIN_PERCENT, percent));
}

/** Round a live drag percent into the canonical value saved in the vault workspace. */
export function persistableTreeSplitPercent(livePercent: number): number {
  return clampCanonicalTreeSplitPercent(Math.round(livePercent));
}

/**
 * Map canonical % → visual % for this axis.
 * Canonical min (4) always lands on the visual min (4 on column, ≥4 on row),
 * so "at minimum" on one layout stays "at minimum" on the other without leftover.
 */
export function displayTreeSplitPercent(
  canonicalPercent: number,
  containerSize: number,
  axis: TreeSplitAxis = "x",
): number {
  const visualMin = visualMinPercent(containerSize, axis);
  if (visualMin >= TREE_SPLIT_MAX_PERCENT) return visualMin;
  const t =
    (clampCanonicalTreeSplitPercent(canonicalPercent) - TREE_SPLIT_MIN_PERCENT) / CANONICAL_SPAN;
  return visualMin + t * (TREE_SPLIT_MAX_PERCENT - visualMin);
}

function visualToCanonical(
  visualPercent: number,
  containerSize: number,
  axis: TreeSplitAxis,
): number {
  const visualMin = visualMinPercent(containerSize, axis);
  if (visualMin >= TREE_SPLIT_MAX_PERCENT) return TREE_SPLIT_MIN_PERCENT;
  const visual = Math.min(TREE_SPLIT_MAX_PERCENT, Math.max(visualMin, visualPercent));
  const t = (visual - visualMin) / (TREE_SPLIT_MAX_PERCENT - visualMin);
  return TREE_SPLIT_MIN_PERCENT + t * CANONICAL_SPAN;
}

/**
 * Drag delta in px from the grab point — keeps the split under the pointer
 * instead of snapping to the pointer on press. The visual drag range
 * [visualMin, 65] maps onto [4, 65] so hitting the desktop px floor stores 4.
 */
export function percentFromDelta(
  startCanonicalPercent: number,
  deltaPx: number,
  containerSize: number,
  axis: TreeSplitAxis = "x",
): number {
  if (containerSize <= 0) return clampCanonicalTreeSplitPercent(startCanonicalPercent);
  const startVisual = displayTreeSplitPercent(startCanonicalPercent, containerSize, axis);
  return visualToCanonical(startVisual + (deltaPx / containerSize) * 100, containerSize, axis);
}
