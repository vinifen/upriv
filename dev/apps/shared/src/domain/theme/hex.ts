/** `#RRGGBB` or `#RRGGBBAA` (optional `#`). CSS and React Native both accept 8-digit hex. */
const HEX_RE = /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i;

function parseHexRgb(hex: string, fn: string): { rgb: string; r: number; g: number; b: number } {
  const match = HEX_RE.exec(hex.trim());
  if (!match) {
    throw new Error(`${fn}: expected #RRGGBB or #RRGGBBAA, got ${JSON.stringify(hex)}`);
  }
  const rgb = match[1].slice(0, 6).toLowerCase();
  return {
    rgb,
    r: Number.parseInt(rgb.slice(0, 2), 16),
    g: Number.parseInt(rgb.slice(2, 4), 16),
    b: Number.parseInt(rgb.slice(4, 6), 16),
  };
}

function channelHex(n: number): string {
  return n.toString(16).padStart(2, "0");
}

/**
 * Paint a hex color at a given opacity as `#RRGGBBAA`.
 * Prefer this over `rgba()` so palettes stay hex end-to-end.
 */
export function hexWithAlpha(hex: string, alpha: number): string {
  const { rgb } = parseHexRgb(hex, "hexWithAlpha");
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return `#${rgb}${channelHex(a)}`;
}

/**
 * Mix two hex colors in sRGB (`tintRatio` of `tint` over `base`).
 * Result is opaque `#RRGGBB` — RN and CSS both accept it; no `rgb()`.
 */
export function mixHex(base: string, tint: string, tintRatio: number): string {
  const b = parseHexRgb(base, "mixHex");
  const t = parseHexRgb(tint, "mixHex");
  const w = Math.min(1, Math.max(0, tintRatio));
  return `#${channelHex(Math.round(b.r * (1 - w) + t.r * w))}${channelHex(Math.round(b.g * (1 - w) + t.g * w))}${channelHex(Math.round(b.b * (1 - w) + t.b * w))}`;
}
