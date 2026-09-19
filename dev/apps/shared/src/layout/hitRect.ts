export interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function pointInHitRect(pageX: number, pageY: number, rect: HitRect): boolean {
  return pageX >= rect.x && pageX <= rect.x + rect.w && pageY >= rect.y && pageY <= rect.y + rect.h;
}

/** Smallest-area rect that contains the point. */
export function smallestContainingKey(
  rects: Iterable<[string, HitRect]>,
  pageX: number,
  pageY: number,
  skip?: (key: string) => boolean,
): string | null {
  let bestKey: string | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const [key, rect] of rects) {
    if (skip?.(key)) continue;
    if (!pointInHitRect(pageX, pageY, rect)) continue;
    const area = rect.w * rect.h;
    if (area < bestArea) {
      bestArea = area;
      bestKey = key;
    }
  }
  return bestKey;
}
