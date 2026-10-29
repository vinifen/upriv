/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  TREE_SPLIT_DEFAULT_PERCENT,
  TREE_SPLIT_MIN_PERCENT,
  type VaultWorkspaceAction,
} from "@upriv/shared";
import { useTreeSplitDrag, type UseTreeSplitDragOptions } from "@upriv/shared/react";

/** 1600 px row: the 64 px floor is 4 %, so visual % equals canonical %. */
const SIZE = 1600;

function renderSplit(overrides: Partial<UseTreeSplitDragOptions> = {}) {
  const dispatch = vi.fn<(action: VaultWorkspaceAction) => void>();
  const view = renderHook((props: UseTreeSplitDragOptions) => useTreeSplitDrag(props), {
    initialProps: {
      savedPercent: 20,
      containerSize: SIZE,
      axis: "x",
      dispatch,
      ...overrides,
    },
  });
  return { ...view, dispatch };
}

describe("useTreeSplitDrag", () => {
  it("starts at the saved percent, or the default when the vault has none", () => {
    expect(renderSplit().result.current.percent).toBe(20);
    const { result } = renderSplit({ savedPercent: null });
    expect(result.current.percent).toBe(TREE_SPLIT_DEFAULT_PERCENT);
    expect(result.current.visualPercent).toBe(TREE_SPLIT_DEFAULT_PERCENT);
  });

  it("follows the saved percent while no drag runs", () => {
    const { result, rerender, dispatch } = renderSplit();
    rerender({ savedPercent: 40, containerSize: SIZE, axis: "x", dispatch });
    expect(result.current.percent).toBe(40);
  });

  it("moves with the pointer and saves the rounded percent on release", () => {
    const { result, dispatch } = renderSplit();
    act(() => result.current.onDragStart());
    act(() => result.current.onDrag(81));
    expect(result.current.percent).toBeCloseTo(25.0625);
    expect(dispatch).not.toHaveBeenCalled();

    act(() => result.current.onDragEnd());
    expect(result.current.percent).toBe(25);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: "set_tree_split_percent", percent: 25 });
  });

  it("keeps the drag percent when the saved value changes mid-drag", () => {
    const { result, rerender, dispatch } = renderSplit();
    act(() => result.current.onDragStart());
    act(() => result.current.onDrag(80));
    rerender({ savedPercent: 50, containerSize: SIZE, axis: "x", dispatch });
    expect(result.current.percent).toBe(25);
  });

  it("hides the explorer when released past half its minimum size", () => {
    const { result, dispatch } = renderSplit();
    act(() => result.current.onDragStart());
    // 320 px − 288 px = 32 px: half of the 64 px floor.
    act(() => result.current.onDrag(-288));
    expect(result.current.visualPercent).toBe(0);

    act(() => result.current.onDragEnd());
    expect(dispatch.mock.calls).toEqual([
      [{ type: "set_tree_split_percent", percent: TREE_SPLIT_MIN_PERCENT }],
      [{ type: "set_explorer_collapsed", collapsed: true }],
    ]);
    expect(result.current.percent).toBe(TREE_SPLIT_MIN_PERCENT);
    expect(result.current.visualPercent).toBe(TREE_SPLIT_MIN_PERCENT);
  });

  it("shows the explorer again when the drag comes back above the threshold", () => {
    const { result, dispatch } = renderSplit();
    act(() => result.current.onDragStart());
    act(() => result.current.onDrag(-300));
    act(() => result.current.onDrag(-200));
    expect(result.current.visualPercent).toBeCloseTo(7.5);

    act(() => result.current.onDragEnd());
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: "set_tree_split_percent", percent: 8 });
  });

  it("paints through onDragFrame without re-rendering each move", () => {
    const onDragFrame = vi.fn<(visualPercent: number, size: number) => void>();
    const { result, dispatch } = renderSplit({ onDragFrame });
    act(() => result.current.onDragStart());
    act(() => result.current.onDrag(80));
    expect(onDragFrame).toHaveBeenLastCalledWith(25, SIZE);
    expect(result.current.percent).toBe(20);

    act(() => result.current.repaintDrag());
    expect(onDragFrame).toHaveBeenCalledTimes(2);
    expect(onDragFrame).toHaveBeenLastCalledWith(25, SIZE);

    act(() => result.current.onDrag(-300));
    expect(onDragFrame).toHaveBeenLastCalledWith(0, SIZE);

    act(() => result.current.onDragEnd());
    act(() => result.current.repaintDrag());
    expect(onDragFrame).toHaveBeenCalledTimes(3);
    expect(dispatch).toHaveBeenCalledWith({ type: "set_explorer_collapsed", collapsed: true });
  });

  it("ignores moves before the container has a size", () => {
    const { result, dispatch } = renderSplit({ containerSize: 0 });
    act(() => result.current.onDragStart());
    act(() => result.current.onDrag(-500));
    expect(result.current.percent).toBe(20);
    act(() => result.current.onDragEnd());
    expect(dispatch).toHaveBeenCalledWith({ type: "set_tree_split_percent", percent: 20 });
  });

  it("commits a keyboard nudge clamped to the canonical range", () => {
    const { result, dispatch } = renderSplit();
    act(() => result.current.commit(TREE_SPLIT_MIN_PERCENT - 3));
    expect(result.current.percent).toBe(TREE_SPLIT_MIN_PERCENT);
    expect(dispatch).toHaveBeenCalledWith({
      type: "set_tree_split_percent",
      percent: TREE_SPLIT_MIN_PERCENT,
    });
  });
});
