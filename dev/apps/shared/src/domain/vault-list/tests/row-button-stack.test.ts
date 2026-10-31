import { describe, expect, it } from "vitest";
import {
  EMPTY_ROW_BUTTON_STACK,
  nextRowButtonStack,
  type RowButtonStack,
  type RowButtonStackPart,
} from "../rowButtonStack";

function measured(
  widths: Partial<Record<RowButtonStackPart, number>>,
  from: RowButtonStack = EMPTY_ROW_BUTTON_STACK,
): RowButtonStack {
  return (Object.entries(widths) as [RowButtonStackPart, number][]).reduce(
    (state, [part, width]) => nextRowButtonStack(state, part, width),
    from,
  );
}

describe("nextRowButtonStack", () => {
  it("keeps the buttons beside text that fits", () => {
    expect(measured({ rowWidth: 400, slotWidth: 200, textWidth: 150 }).stacked).toBe(false);
  });

  it("keeps the buttons beside text cut by exactly 30%", () => {
    expect(measured({ rowWidth: 400, slotWidth: 140, textWidth: 200 }).stacked).toBe(false);
  });

  it("stacks once more than 30% of the text would be cut", () => {
    expect(measured({ rowWidth: 400, slotWidth: 139, textWidth: 200 }).stacked).toBe(true);
  });

  it("counts what sits next to the text as lost room", () => {
    const widths = { rowWidth: 400, slotWidth: 160, textWidth: 200 };
    expect(measured(widths).stacked).toBe(false);
    expect(measured({ ...widths, besideWidth: 30 }).stacked).toBe(true);
  });

  it("stays side by side until every width is known", () => {
    expect(measured({ textWidth: 900 }).stacked).toBe(false);
    expect(measured({ rowWidth: 300, textWidth: 900 }).stacked).toBe(false);
    expect(measured({ rowWidth: 300, slotWidth: 100 }).stacked).toBe(false);
  });

  it("ignores the wider text box of the stacked layout", () => {
    const stacked = measured({ rowWidth: 400, slotWidth: 100, textWidth: 200 });
    expect(stacked.stacked).toBe(true);
    const redrawn = measured({ slotWidth: 340 }, stacked);
    expect(redrawn.stacked).toBe(true);
    expect(redrawn.reservedWidth).toBe(stacked.reservedWidth);
  });

  it("goes back beside the text when the row grows enough", () => {
    const stacked = measured({ rowWidth: 400, slotWidth: 100, textWidth: 200 });
    expect(measured({ rowWidth: 430 }, stacked).stacked).toBe(true);
    expect(measured({ rowWidth: 440 }, stacked).stacked).toBe(false);
  });

  it("stacks when a longer name arrives", () => {
    const fits = measured({ rowWidth: 400, slotWidth: 200, textWidth: 150 });
    expect(measured({ textWidth: 400 }, fits).stacked).toBe(true);
  });

  it("returns the same state for the same width", () => {
    const state = measured({ rowWidth: 400, slotWidth: 200 });
    expect(nextRowButtonStack(state, "rowWidth", 400.2)).toBe(state);
  });
});
