/** @vitest-environment jsdom */
import { WHEEL_SCROLL_MS } from "@upriv/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSmoothScroller } from "@/lib/smoothWheelScroll";

function scrollBox({ width = 100, contentWidth = 600, height = 100, contentHeight = 100 } = {}) {
  const el = document.createElement("div");
  Object.defineProperties(el, {
    clientWidth: { value: width },
    scrollWidth: { value: contentWidth },
    clientHeight: { value: height },
    scrollHeight: { value: contentHeight },
  });
  return el;
}

describe("createSmoothScroller", () => {
  let reducedMotion = false;
  let now = 0;
  let frames: FrameRequestCallback[] = [];

  const runFrames = (ms: number) => {
    for (let t = 0; t < ms; t += 16) {
      now += 16;
      const due = frames;
      frames = [];
      for (const cb of due) cb(now);
    }
  };

  beforeEach(() => {
    reducedMotion = false;
    now = 0;
    frames = [];
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: reducedMotion })),
    );
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: FrameRequestCallback) => {
        frames.push(cb);
        return frames.length;
      }),
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn(() => (frames = [])),
    );
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("glides a wheel notch over several frames instead of jumping", () => {
    const el = scrollBox();
    const scroller = createSmoothScroller(el);

    expect(scroller.scrollBy(120, 0)).toBe(true);
    expect(el.scrollLeft).toBe(0);

    runFrames(48);
    expect(el.scrollLeft).toBeGreaterThan(0);
    expect(el.scrollLeft).toBeLessThan(120);

    runFrames(WHEEL_SCROLL_MS);
    expect(el.scrollLeft).toBe(120);
  });

  it("adds a notch that arrives mid-glide to the destination", () => {
    const el = scrollBox();
    const scroller = createSmoothScroller(el);

    scroller.scrollBy(120, 0);
    runFrames(48);
    scroller.scrollBy(120, 0);
    runFrames(WHEEL_SCROLL_MS + 32);
    expect(el.scrollLeft).toBe(240);
  });

  it("applies trackpad-sized steps at once", () => {
    const el = scrollBox();
    createSmoothScroller(el).scrollBy(12, 0);
    expect(el.scrollLeft).toBe(12);
    expect(frames).toHaveLength(0);
  });

  it("clamps to the scroll range and reports the edge", () => {
    const el = scrollBox({ contentWidth: 150 });
    const scroller = createSmoothScroller(el);

    expect(scroller.scrollBy(-120, 0)).toBe(false);
    expect(scroller.scrollBy(120, 0)).toBe(true);
    runFrames(WHEEL_SCROLL_MS + 32);
    expect(el.scrollLeft).toBe(50);
    expect(scroller.scrollBy(120, 0)).toBe(false);
  });

  it("jumps without animation under reduced motion", () => {
    reducedMotion = true;
    const el = scrollBox();
    createSmoothScroller(el).scrollBy(120, 0);
    expect(el.scrollLeft).toBe(120);
  });
});
