import { WHEEL_SCROLL_MS } from "@upriv/shared";

/** Pixel steps at or under this come from trackpads / hi-res wheels, already smooth — apply as is. */
const FINE_STEP_PX = 40;
const LINE_PX = 16;

/** Wheel delta in pixels (Chromium sends pixels; lines/pages only from odd devices). */
export function wheelDeltaPx(event: WheelEvent, el: HTMLElement): { x: number; y: number } {
  const scale =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? LINE_PX
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? Math.max(el.clientHeight, LINE_PX)
        : 1;
  return { x: event.deltaX * scale, y: event.deltaY * scale };
}

export interface SmoothScroller {
  /** Glide by this many pixels; returns false when already at the edge (let the event through). */
  scrollBy: (dx: number, dy: number) => boolean;
  dispose: () => void;
}

/** Wheel scrolling the app drives itself (redirected axis / forwarded area) that eases like native. */
export function createSmoothScroller(el: HTMLElement): SmoothScroller {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let frame = 0;
  let start = 0;
  let fromX = 0;
  let fromY = 0;
  let toX = el.scrollLeft;
  let toY = el.scrollTop;

  const clamp = (value: number, max: number) => Math.min(Math.max(0, max), Math.max(0, value));

  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / WHEEL_SCROLL_MS);
    const eased = 1 - (1 - t) ** 3;
    /* Only touch an axis we are moving, so native scrolling on the other axis is not fought. */
    if (toX !== fromX) el.scrollLeft = fromX + (toX - fromX) * eased;
    if (toY !== fromY) el.scrollTop = fromY + (toY - fromY) * eased;
    frame = t < 1 ? requestAnimationFrame(tick) : 0;
  };

  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  return {
    scrollBy(dx, dy) {
      /* Mid-glide notches add to the destination; an idle axis starts from where it really is. */
      const baseX = frame && toX !== fromX ? toX : el.scrollLeft;
      const baseY = frame && toY !== fromY ? toY : el.scrollTop;
      const nextX = clamp(baseX + dx, el.scrollWidth - el.clientWidth);
      const nextY = clamp(baseY + dy, el.scrollHeight - el.clientHeight);
      if (nextX === baseX && nextY === baseY) return false;
      toX = nextX;
      toY = nextY;

      if (reduceMotion || Math.max(Math.abs(dx), Math.abs(dy)) <= FINE_STEP_PX) {
        stop();
        el.scrollLeft = toX;
        el.scrollTop = toY;
        return true;
      }
      fromX = el.scrollLeft;
      fromY = el.scrollTop;
      start = performance.now();
      if (!frame) frame = requestAnimationFrame(tick);
      return true;
    },
    dispose: stop,
  };
}
