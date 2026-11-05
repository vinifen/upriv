/**
 * Width of a note's outline column, in CSS px (dp on phones). Each `.md` file
 * keeps its own; a file without one draws the platform default.
 */
export const OUTLINE_WIDTH_MIN_PX = 112;
export const OUTLINE_WIDTH_MAX_PX = 640;
/** The outline never takes more of the editor row than this; layouts use it as a max width. */
export const OUTLINE_MAX_ROW_SHARE = 0.6;
/** A drag that leaves less than this share of the minimum closes the outline. */
const OUTLINE_COLLAPSE_RATIO = 0.5;

/** Clamp into [`OUTLINE_WIDTH_MIN_PX`, `OUTLINE_WIDTH_MAX_PX`]. */
export function clampOutlineWidth(width: number): number {
  return Math.min(OUTLINE_WIDTH_MAX_PX, Math.max(OUTLINE_WIDTH_MIN_PX, width));
}

/** Round and clamp a live width into the value saved for the file. */
export function persistableOutlineWidth(width: number): number {
  return clampOutlineWidth(Math.round(width));
}

/** Widest the outline may draw beside a note in a row this wide (unmeasured: no row limit). */
function outlineWidthLimit(rowWidth: number): number {
  if (rowWidth <= 0) return OUTLINE_WIDTH_MAX_PX;
  const share = rowWidth * OUTLINE_MAX_ROW_SHARE;
  return Math.max(OUTLINE_WIDTH_MIN_PX, Math.min(OUTLINE_WIDTH_MAX_PX, share));
}

/** Saved width as drawn in this row. */
export function displayOutlineWidth(width: number, rowWidth: number): number {
  return Math.min(outlineWidthLimit(rowWidth), clampOutlineWidth(width));
}

/**
 * Width after the divider moved `deltaPx` from where it was grabbed. The
 * outline sits right of its divider, so a move left widens it.
 */
export function outlineWidthFromDrag(
  startWidth: number,
  deltaPx: number,
  rowWidth: number,
): number {
  return displayOutlineWidth(startWidth - deltaPx, rowWidth);
}

/** Whether that move pushed the divider far enough toward the edge to close the outline. */
export function isOutlineDragCollapsed(startWidth: number, deltaPx: number): boolean {
  return startWidth - deltaPx <= OUTLINE_WIDTH_MIN_PX * OUTLINE_COLLAPSE_RATIO;
}
