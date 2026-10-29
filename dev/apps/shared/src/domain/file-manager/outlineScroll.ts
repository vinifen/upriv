/** Scroll state of a note view, in px. */
export interface OutlineScroll {
  /** Distance scrolled from the top. */
  offset: number;
  /** Visible height. */
  viewport: number;
  /** Full height of the note. */
  content: number;
}

/** Within this distance of the top, the first heading is current. */
const TOP_SLACK_PX = 10;
/** Within this distance of the end, the last heading is current. */
const END_SLACK_PX = 16;
/** A heading this far below the top edge already counts as reached. */
const ACTIVE_LEAD_PX = 24;

/**
 * Outline entry to mark as current: the last heading whose top has reached
 * the top edge. Scrolled to the end it is the last one, even when a short
 * last section can never reach the top. `headingTops` are content offsets in
 * outline order; `undefined` is a heading not laid out yet.
 */
export function activeOutlineIndex(
  headingTops: readonly (number | undefined)[],
  scroll: OutlineScroll,
): number {
  if (headingTops.length === 0 || scroll.offset <= TOP_SLACK_PX) return 0;
  if (
    scroll.content > scroll.viewport &&
    scroll.offset + scroll.viewport >= scroll.content - END_SLACK_PX
  ) {
    return headingTops.length - 1;
  }
  let active = 0;
  for (let index = 0; index < headingTops.length; index++) {
    const top = headingTops[index];
    if (top === undefined) continue;
    if (top > scroll.offset + ACTIVE_LEAD_PX) break;
    active = index;
  }
  return active;
}
