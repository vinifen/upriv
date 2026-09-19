export const TREE_SPLIT_DEFAULT_PERCENT = 20;
export const TREE_SPLIT_MIN_PERCENT = 15;
export const TREE_SPLIT_MAX_PERCENT = 65;
/** Floor for horizontal (row) sidebar width — display only; never written into shared %. */
export const TREE_SPLIT_MIN_PX = 144;
/** Column has no px floor — shared min is always TREE_SPLIT_MIN_PERCENT. */
export const TREE_SPLIT_MIN_PX_COLUMN = 0;

export type TreeSplitAxis = "x" | "y";

export function treeSplitMinPx(axis: TreeSplitAxis): number {
  return axis === "y" ? TREE_SPLIT_MIN_PX_COLUMN : TREE_SPLIT_MIN_PX;
}

/** Visual min % for the current axis/container (may be > 15% on mid-width rows). */
export function treeSplitVisualMinPercent(
  containerSize: number,
  axis: TreeSplitAxis = "x",
): number {
  if (containerSize <= 0) return TREE_SPLIT_MIN_PERCENT;
  const minPx = treeSplitMinPx(axis);
  return Math.max(TREE_SPLIT_MIN_PERCENT, (minPx / containerSize) * 100);
}

/** Clamp into the shared canonical range [15, 65] — what we persist. */
export function clampCanonicalTreeSplitPercent(percent: number): number {
  return Math.min(TREE_SPLIT_MAX_PERCENT, Math.max(TREE_SPLIT_MIN_PERCENT, percent));
}

/** Round a live drag percent into the canonical value written to settings. */
export function persistableTreeSplitPercent(livePercent: number): number {
  return clampCanonicalTreeSplitPercent(Math.round(livePercent));
}

/**
 * Map shared canonical % → visual % for this axis.
 * Canonical min (15) always lands on the visual min (15 on column, ≥15 on row),
 * so "at minimum" on one layout stays "at minimum" on the other without leftover.
 */
export function displayTreeSplitPercent(
  canonicalPercent: number,
  containerSize: number,
  axis: TreeSplitAxis = "x",
): number {
  const canonical = clampCanonicalTreeSplitPercent(canonicalPercent);
  const visualMin = treeSplitVisualMinPercent(containerSize, axis);
  const visualMax = TREE_SPLIT_MAX_PERCENT;
  const span = TREE_SPLIT_MAX_PERCENT - TREE_SPLIT_MIN_PERCENT;
  if (span <= 0 || visualMax <= visualMin) return visualMin;
  const t = (canonical - TREE_SPLIT_MIN_PERCENT) / span;
  return visualMin + t * (visualMax - visualMin);
}

function visualToCanonical(
  visualPercent: number,
  containerSize: number,
  axis: TreeSplitAxis,
): number {
  const visualMin = treeSplitVisualMinPercent(containerSize, axis);
  const visualMax = TREE_SPLIT_MAX_PERCENT;
  const visual = Math.min(visualMax, Math.max(visualMin, visualPercent));
  const visualSpan = visualMax - visualMin;
  if (visualSpan <= 0) return TREE_SPLIT_MIN_PERCENT;
  const t = (visual - visualMin) / visualSpan;
  return clampCanonicalTreeSplitPercent(
    TREE_SPLIT_MIN_PERCENT + t * (TREE_SPLIT_MAX_PERCENT - TREE_SPLIT_MIN_PERCENT),
  );
}

/**
 * Pointer → shared canonical %. The visual drag range [visualMin, 65] maps onto
 * [15, 65] so hitting the desktop px floor stores 15, not 18.
 */
export function percentFromPointer(
  clientPos: number,
  containerStart: number,
  containerSize: number,
  axis: TreeSplitAxis = "x",
): number {
  if (containerSize <= 0) return TREE_SPLIT_DEFAULT_PERCENT;
  const raw = ((clientPos - containerStart) / containerSize) * 100;
  return visualToCanonical(raw, containerSize, axis);
}

/**
 * Drag delta in px from the grab point — keeps the split under the pointer
 * instead of snapping to the pointer on press.
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
