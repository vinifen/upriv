/** Floor for the list "Closing" badge after a successful close. */
export const MIN_CLOSING_DISPLAY_MS = 2_000;

/** Remaining time so Open → Closed is not a one-frame snap when close is instant. */
export function remainingClosingDisplayMs(startedAt: number, now = Date.now()): number {
  return Math.max(0, MIN_CLOSING_DISPLAY_MS - (now - startedAt));
}
