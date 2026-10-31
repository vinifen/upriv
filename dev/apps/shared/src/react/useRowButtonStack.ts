import { useCallback, useState } from "react";
import { EMPTY_ROW_BUTTON_STACK, nextRowButtonStack, type RowButtonStackPart } from "@upriv/shared";

/** Whether a row's buttons go below its text, from the widths its view reports. */
export function useRowButtonStack(): {
  stacked: boolean;
  measure: (part: RowButtonStackPart, width: number) => void;
} {
  const [state, setState] = useState(EMPTY_ROW_BUTTON_STACK);
  const measure = useCallback((part: RowButtonStackPart, width: number) => {
    setState((current) => nextRowButtonStack(current, part, width));
  }, []);
  return { stacked: state.stacked, measure };
}
