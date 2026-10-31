import { useLayoutEffect, type RefObject } from "react";
import { useRowButtonStack } from "@upriv/shared/react";

interface RowButtonsBelowRefs {
  row: RefObject<HTMLElement | null>;
  /** The box the text and anything next to it share. */
  slot: RefObject<HTMLElement | null>;
  /** The truncating text. Its `scrollWidth` is the uncut width. */
  text: RefObject<HTMLElement | null>;
  /** What sits next to the text in that box. */
  beside?: RefObject<HTMLElement | null>;
}

/** True while `text` would lose too much beside the row's buttons (`text` is what it shows). */
export function useRowButtonsBelow(
  { row, slot, text, beside }: RowButtonsBelowRefs,
  shownText: string,
): boolean {
  const { stacked, measure } = useRowButtonStack();

  useLayoutEffect(() => {
    const rowEl = row.current;
    const slotEl = slot.current;
    const textEl = text.current;
    if (!rowEl || !slotEl || !textEl) return;

    const apply = () => {
      measure("rowWidth", rowEl.getBoundingClientRect().width);
      measure("besideWidth", beside?.current?.getBoundingClientRect().width ?? 0);
      measure("textWidth", textEl.scrollWidth);
      measure("slotWidth", slotEl.getBoundingClientRect().width);
    };

    apply();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(apply);
    observer.observe(rowEl);
    observer.observe(slotEl);
    if (beside?.current) observer.observe(beside.current);
    return () => observer.disconnect();
  }, [beside, measure, row, shownText, slot, text]);

  return stacked;
}
