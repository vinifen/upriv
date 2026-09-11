import { describe, expect, it } from "vitest";
import { isTriggerOccluded } from "../triggerClip";

const viewport = { width: 800, height: 600 };
const trigger = { top: 200, right: 400, bottom: 248, left: 80 };

describe("isTriggerOccluded", () => {
  it("keeps a fully visible trigger", () => {
    expect(isTriggerOccluded(trigger, [], viewport, 8)).toBe(false);
  });

  it("closes when the trigger leaves the window", () => {
    expect(isTriggerOccluded({ top: -40, right: 400, bottom: 4, left: 80 }, [], viewport, 8)).toBe(
      true,
    );
    expect(
      isTriggerOccluded({ top: 598, right: 400, bottom: 640, left: 80 }, [], viewport, 8),
    ).toBe(true);
  });

  it("closes when a scrollport no longer intersects the trigger", () => {
    const body = { top: 120, right: 760, bottom: 180, left: 40 };
    expect(isTriggerOccluded(trigger, [body], viewport, 8)).toBe(true);
  });

  it("keeps the trigger while it still overlaps the scrollport", () => {
    const body = { top: 160, right: 760, bottom: 520, left: 40 };
    expect(isTriggerOccluded(trigger, [body], viewport, 8)).toBe(false);
  });
});
