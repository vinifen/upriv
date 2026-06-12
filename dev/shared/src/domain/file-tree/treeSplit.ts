export const TREE_SPLIT_DEFAULT_PERCENT = 20;
export const TREE_SPLIT_MIN_PERCENT = 15;
export const TREE_SPLIT_MAX_PERCENT = 65;
export const TREE_SPLIT_MIN_PX = 144;

export function clampTreeSplitPercent(percent: number, containerSize: number): number {
  const minPercent = Math.max(TREE_SPLIT_MIN_PERCENT, (TREE_SPLIT_MIN_PX / containerSize) * 100);
  const maxPercent = TREE_SPLIT_MAX_PERCENT;
  return Math.min(maxPercent, Math.max(minPercent, percent));
}

export function percentFromPointer(
  clientPos: number,
  containerStart: number,
  containerSize: number,
): number {
  return clampTreeSplitPercent(((clientPos - containerStart) / containerSize) * 100, containerSize);
}
