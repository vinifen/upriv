export interface MenuAnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MenuPlacement {
  top: number;
  left: number;
  maxHeight: number;
  side: "below" | "above";
}

/**
 * Sit the menu against the trigger. Prefer the side where the full panel
 * fits; if both (or neither) fit, use the side with more room.
 */
export function placeAnchoredMenu(input: {
  anchor: MenuAnchorRect;
  panelWidth: number;
  panelHeight: number;
  viewport: { width: number; height: number };
  padding: { top: number; right: number; bottom: number; left: number };
  gap: number;
  align: "left" | "right";
}): MenuPlacement {
  const spaceBelow =
    input.viewport.height -
    input.padding.bottom -
    (input.anchor.y + input.anchor.height + input.gap);
  const spaceAbove = input.anchor.y - input.gap - input.padding.top;
  const needed = Math.max(1, input.panelHeight);
  const fitsBelow = spaceBelow >= needed;
  const fitsAbove = spaceAbove >= needed;

  let side: "below" | "above";
  if (fitsBelow !== fitsAbove) {
    side = fitsBelow ? "below" : "above";
  } else {
    side = spaceBelow >= spaceAbove ? "below" : "above";
  }

  const maxHeight = Math.max(1, side === "below" ? spaceBelow : spaceAbove);
  const usedH = Math.min(needed, maxHeight);
  const rawTop =
    side === "below"
      ? input.anchor.y + input.anchor.height + input.gap
      : input.anchor.y - input.gap - usedH;
  const minTop = input.padding.top;
  const maxTop = input.viewport.height - input.padding.bottom - usedH;
  const top = Math.max(minTop, Math.min(rawTop, Math.max(minTop, maxTop)));

  const rawLeft =
    input.align === "right"
      ? input.anchor.x + input.anchor.width - input.panelWidth
      : input.anchor.x;
  const left = Math.max(
    input.padding.left,
    Math.min(rawLeft, input.viewport.width - input.padding.right - input.panelWidth),
  );

  return { top, left, maxHeight, side };
}
