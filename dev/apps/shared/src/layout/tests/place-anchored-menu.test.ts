import { describe, expect, it } from "vitest";
import { placeAnchoredMenu } from "../placeAnchoredMenu";

const padding = { top: 12, right: 12, bottom: 12, left: 12 };
const gap = 8;
const viewport = { width: 400, height: 800 };

describe("placeAnchoredMenu", () => {
  it("opens below a top-row trigger and sits against the button", () => {
    const placed = placeAnchoredMenu({
      anchor: { x: 340, y: 120, width: 44, height: 44 },
      panelWidth: 220,
      panelHeight: 200,
      viewport,
      padding,
      gap,
      align: "right",
    });
    expect(placed.side).toBe("below");
    expect(placed.top).toBe(120 + 44 + gap);
    expect(placed.left).toBe(340 + 44 - 220);
  });

  it("opens above a bottom-row trigger and sits against the button", () => {
    const placed = placeAnchoredMenu({
      anchor: { x: 340, y: 700, width: 44, height: 44 },
      panelWidth: 220,
      panelHeight: 200,
      viewport,
      padding,
      gap,
      align: "right",
    });
    expect(placed.side).toBe("above");
    expect(placed.top).toBe(700 - gap - 200);
  });

  it("does not pin an upward menu to the top of the screen", () => {
    const placed = placeAnchoredMenu({
      anchor: { x: 340, y: 500, width: 44, height: 44 },
      panelWidth: 220,
      panelHeight: 180,
      viewport,
      padding,
      gap,
      align: "right",
    });
    expect(placed.side).toBe("above");
    expect(placed.top).toBeGreaterThan(200);
    expect(placed.top + 180).toBe(500 - gap);
  });
});
