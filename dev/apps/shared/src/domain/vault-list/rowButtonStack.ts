/**
 * A list row keeps its buttons beside its text until that would cut off more
 * than this share of the text. Then the buttons take a line of their own.
 */
export const ROW_TEXT_MAX_CUT = 0.3;

export interface RowButtonStack {
  /** The whole row. */
  rowWidth: number;
  /** The box the text and anything next to it share. */
  slotWidth: number;
  /** What sits next to the text in that box: indicators, a badge. */
  besideWidth: number;
  /** The text on one line, uncut. */
  textWidth: number;
  /** Row width the text cannot use while the buttons are beside it. */
  reservedWidth: number;
  /** The buttons are below the text. */
  stacked: boolean;
}

export type RowButtonStackPart = "rowWidth" | "slotWidth" | "besideWidth" | "textWidth";

export const EMPTY_ROW_BUTTON_STACK: RowButtonStack = {
  rowWidth: 0,
  slotWidth: 0,
  besideWidth: 0,
  textWidth: 0,
  reservedWidth: 0,
  stacked: false,
};

/**
 * The row after one measurement. Only the side-by-side layout shows what the
 * buttons take, so the stacked layout keeps that figure and follows the row's
 * width. The answer does not depend on the layout it is measuring, so a row
 * cannot flip back and forth at the limit.
 */
export function nextRowButtonStack(
  current: RowButtonStack,
  part: RowButtonStackPart,
  width: number,
): RowButtonStack {
  const rounded = Math.round(width);
  if (current[part] === rounded) return current;
  const next = { ...current, [part]: rounded };
  const reservedWidth =
    current.stacked || next.rowWidth <= 0 || next.slotWidth <= 0
      ? current.reservedWidth
      : next.rowWidth - next.slotWidth + next.besideWidth;
  const stacked =
    reservedWidth > 0 &&
    next.textWidth > 0 &&
    next.rowWidth - reservedWidth < next.textWidth * (1 - ROW_TEXT_MAX_CUT);
  return { ...next, reservedWidth, stacked };
}
