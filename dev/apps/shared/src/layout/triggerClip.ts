export interface ClipRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const MIN_VISIBLE_PX = 4;

/** True when the trigger is off-screen or outside a scrollport (clipped). */
export function isTriggerOccluded(
  trigger: ClipRect,
  clipRects: readonly ClipRect[],
  viewport: { width: number; height: number },
  edgePx: number,
  minVisiblePx = MIN_VISIBLE_PX,
): boolean {
  if (trigger.bottom < edgePx || trigger.top > viewport.height - edgePx) return true;
  if (trigger.right < edgePx || trigger.left > viewport.width - edgePx) return true;
  for (const clip of clipRects) {
    const overlapW = Math.min(trigger.right, clip.right) - Math.max(trigger.left, clip.left);
    const overlapH = Math.min(trigger.bottom, clip.bottom) - Math.max(trigger.top, clip.top);
    if (overlapW < minVisiblePx || overlapH < minVisiblePx) return true;
  }
  return false;
}
