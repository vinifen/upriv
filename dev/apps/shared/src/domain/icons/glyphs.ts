import type { IconName } from "./names";

export type IconStrokeCap = "round" | "butt" | "square";
export type IconStrokeJoin = "round" | "miter" | "bevel";
export type IconFill = "none" | "current";

type IconPath = {
  kind: "path";
  d: string;
  strokeWidth?: number;
  strokeLinecap?: IconStrokeCap;
  strokeLinejoin?: IconStrokeJoin;
  fill?: IconFill;
};

type IconCircle = {
  kind: "circle";
  cx: number;
  cy: number;
  r: number;
  strokeWidth?: number;
  fill?: IconFill;
};

type IconRect = {
  kind: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
  strokeWidth?: number;
  fill?: IconFill;
};

/** Platform-agnostic SVG primitives for one glyph (viewBox 0 0 24 24). */
export type IconShape = IconPath | IconCircle | IconRect;

const PATH_EYE_OFF =
  "M10.7 10.7a2.5 2.5 0 0 0 3.5 3.5M6.3 6.3C4.6 7.6 3.3 9.4 2.5 12c1.7 " +
  "4.2 6 7 9.5 7 1.4 0 2.8-.4 4.1-1.1M9.9 5.1A10.8 10.8 0 0 1 12 5c3.5 0 " +
  "7.8 2.8 9.5 7-.6 1.5-1.6 2.9-2.8 4";

/** Feather-style cog (viewBox 0 0 24 24). Hub is a separate circle. */
const PATH_SETTINGS =
  "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 " +
  "1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 " +
  "2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 " +
  "0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 " +
  "0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 " +
  "2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 " +
  "0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 " +
  "0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 " +
  "1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 " +
  "2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 " +
  "0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z";

const PATH_TRASH =
  "M4 7h16M7 7V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2M9 11v7M12 11v7M15 11v7M6 " +
  "7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13";

const p = (d: string, extra: Omit<IconPath, "kind" | "d"> = { strokeWidth: 1.75 }): IconPath => ({
  kind: "path",
  d,
  ...extra,
});

const c = (
  cx: number,
  cy: number,
  r: number,
  extra: Omit<IconCircle, "kind" | "cx" | "cy" | "r">,
): IconCircle => ({
  kind: "circle",
  cx,
  cy,
  r,
  ...extra,
});

const r = (
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Omit<IconRect, "kind" | "x" | "y" | "width" | "height">,
): IconRect => ({ kind: "rect", x, y, width, height, ...extra });

const stroke = { strokeWidth: 1.75 } as const;
const round = { strokeWidth: 1.75, strokeLinecap: "round" as const };
const roundJoin = {
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Shared glyph geometry — desktop `<path>` / mobile `<Path>` both render this. */
export const ICON_GLYPHS: Record<IconName, readonly IconShape[]> = {
  add: [p("M12 5v14M5 12h14", { strokeWidth: 2, strokeLinecap: "round" })],
  archive: [
    p("M4 7h16v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z", {
      strokeWidth: 1.75,
      strokeLinejoin: "round",
    }),
    p("M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", stroke),
    p("M10 12h4", round),
  ],
  backups: [
    p("M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.9-1.1A4 4 0 1 1 17 18H7z", stroke),
    p("M12 12v6M9 15l3 3 3-3", roundJoin),
  ],
  "arrow-up": [p("M12 5v14M7 10l5-5 5 5", roundJoin)],
  "arrow-down": [p("M12 5v14M7 14l5 5 5-5", roundJoin)],
  "chevron-down": [
    p("M6 9l6 6 6-6", { strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }),
  ],
  clock: [c(12, 12, 8, stroke), p("M12 8v4l3 2", roundJoin)],
  close: [p("M6 6l12 12M18 6L6 18", round)],
  cpu: [
    r(4, 4, 16, 16, { rx: 2, strokeWidth: 1.75 }),
    r(9, 9, 6, 6, { rx: 1, strokeWidth: 1.75 }),
    p("M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2", round),
  ],
  download: [p("M12 4v10M8 10l4 4 4-4", roundJoin), p("M5 18h14", round)],
  encrypted: [r(5, 11, 14, 10, { rx: 2, strokeWidth: 1.75 }), p("M8 11V8a4 4 0 0 1 8 0v3", stroke)],
  "eye-off": [p(PATH_EYE_OFF, roundJoin), p("M3 3l18 18", round)],
  eye: [
    p("M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z", roundJoin),
    c(12, 12, 3, stroke),
  ],
  "grip-vertical": [
    c(9, 6, 1.25, { fill: "current" }),
    c(9, 12, 1.25, { fill: "current" }),
    c(9, 18, 1.25, { fill: "current" }),
    c(15, 6, 1.25, { fill: "current" }),
    c(15, 12, 1.25, { fill: "current" }),
    c(15, 18, 1.25, { fill: "current" }),
  ],
  folder: [
    p("M4 8h6l2 2h8v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z", {
      strokeWidth: 1.75,
      strokeLinejoin: "round",
    }),
    p("M4 8V6a2 2 0 0 1 2-2h4l2 2", stroke),
  ],
  file: [
    p("M8 4h6l4 4v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", {
      strokeWidth: 1.75,
      strokeLinejoin: "round",
    }),
    p("M14 4v4h4", { strokeWidth: 1.75, strokeLinejoin: "round" }),
  ],
  "file-manager": [
    r(4, 5, 16, 14, { rx: 2, strokeWidth: 1.75 }),
    p("M10 5v14", stroke),
    p("M6 9.5h3M6 12.5h3M6 15.5h2.5", { strokeWidth: 1.5, strokeLinecap: "round" }),
    p("M12.5 10h6M12.5 14h4", { strokeWidth: 1.5, strokeLinecap: "round" }),
  ],
  help: [
    c(12, 12, 9, stroke),
    p("M9.5 9.5a2.5 2.5 0 0 1 4.2 1.8c0 2-2.7 2.2-2.7 3.7", round),
    c(12, 17, 0.75, { fill: "current" }),
  ],
  history: [
    p("M3 12a9 9 0 1 0 3-6.7", round),
    p("M3 4v5h5", roundJoin),
    p("M12 7v5l3 2", roundJoin),
  ],
  info: [c(12, 12, 9, stroke), c(12, 8.25, 0.85, { fill: "current" }), p("M12 11v5", round)],
  minus: [p("M6 12h12", { strokeWidth: 2, strokeLinecap: "round" })],
  lock: [r(5, 11, 14, 10, { rx: 2, strokeWidth: 1.75 }), p("M8 11V8a4 4 0 0 1 8 0v3", stroke)],
  "lock-open": [r(5, 11, 14, 10, { rx: 2, strokeWidth: 1.75 }), p("M8 11V8a4 4 0 0 1 8 0", stroke)],
  "more-horizontal": [
    c(5, 12, 1.25, { fill: "current" }),
    c(12, 12, 1.25, { fill: "current" }),
    c(19, 12, 1.25, { fill: "current" }),
  ],
  "more-vertical": [
    c(12, 5, 1.25, { fill: "current" }),
    c(12, 12, 1.25, { fill: "current" }),
    c(12, 19, 1.25, { fill: "current" }),
  ],
  note: [
    p("M7 4h10a2 2 0 0 1 2 2v14l-4-3H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", {
      strokeWidth: 1.75,
      strokeLinejoin: "round",
    }),
    p("M11 9h6M11 13h4", round),
  ],
  refresh: [
    p("M4 12a8 8 0 0 1 13.5-5.7", round),
    p("M20 3v5h-5", roundJoin),
    p("M20 12a8 8 0 0 1-13.5 5.7", round),
    p("M4 21v-5h5", roundJoin),
  ],
  search: [c(11, 11, 7, stroke), p("M20 20l-3.9-3.9", round)],
  settings: [c(12, 12, 3, stroke), p(PATH_SETTINGS, roundJoin)],
  terminal: [r(3, 5, 18, 14, { rx: 2, strokeWidth: 1.75 }), p("M7 10l3 3-3 3M12 16h5", roundJoin)],
  sort: [p("M4 8h8M4 12h6M4 16h4", round), p("M16 6v12M13 9l3-3 3 3M13 15l3 3 3-3", roundJoin)],
  "layout-grid": [
    r(4, 4, 7, 7, { rx: 1.5, strokeWidth: 1.75 }),
    r(13, 4, 7, 7, { rx: 1.5, strokeWidth: 1.75 }),
    r(4, 13, 7, 7, { rx: 1.5, strokeWidth: 1.75 }),
    r(13, 13, 7, 7, { rx: 1.5, strokeWidth: 1.75 }),
  ],
  layers: [
    p("M12 2 2 7l10 5 10-5-10-5z", { strokeWidth: 1.75, strokeLinejoin: "round" }),
    p("M2 12 12 17 22 12", roundJoin),
    p("M2 17 12 22 22 17", roundJoin),
  ],
  "list-rows": [p("M5 7h14M5 12h14M5 17h10", round)],
  "list-rows-loose": [p("M5 6h14M5 12h14M5 18h10", { strokeWidth: 2, strokeLinecap: "round" })],
  "list-rows-tight": [p("M5 8h14M5 12h14M5 16h10", { strokeWidth: 1.5, strokeLinecap: "round" })],
  "sort-alpha": [p("M8 6h8M8 10h6M8 14h4", round), p("M16 6v12M14 8l2-2 2 2", roundJoin)],
  "sort-state": [
    c(8, 9, 2, { strokeWidth: 1.5 }),
    c(16, 9, 2, { strokeWidth: 1.5 }),
    c(12, 16, 2, { strokeWidth: 1.5 }),
    p("M9.5 10.5L11 14M14.5 10.5L13 14", { strokeWidth: 1.5, strokeLinecap: "round" }),
  ],
  trash: [p(PATH_TRASH, roundJoin)],
};
