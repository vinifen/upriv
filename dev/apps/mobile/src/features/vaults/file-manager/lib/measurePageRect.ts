import type { View } from "react-native";

export interface PageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Page coords — same space as `nativeEvent.pageX/Y`.
 * `measureInWindow` drifts inside the FM overlay.
 */
export function measurePageRect(view: View, store: (rect: PageRect) => void): void {
  view.measure((_x, _y, w, h, pageX, pageY) => {
    if (
      typeof pageX !== "number" ||
      typeof pageY !== "number" ||
      typeof w !== "number" ||
      typeof h !== "number" ||
      w <= 0 ||
      h <= 0
    ) {
      return;
    }
    store({ x: pageX, y: pageY, w, h });
  });
}
