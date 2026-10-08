import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  BOOT_COVER_FADE_MS,
  BOOT_COVER_MIN_MS,
  DEFAULT_UI_THEME,
  cssCustomProperties,
} from "@upriv/shared";
import { UprivAppIcon } from "@/components/brand/UprivAppIcon";

const BOOT_THEME_STYLE = {
  ...cssCustomProperties(DEFAULT_UI_THEME),
  colorScheme: DEFAULT_UI_THEME === "light" ? "light" : "dark",
  transitionDuration: `${BOOT_COVER_FADE_MS}ms`,
} as CSSProperties;

interface AppBootCoverProps {
  /** Settings and the first vault-root resolve settled — fade out and unmount. */
  done: boolean;
  /** Budgeted status / retry under the logo; `null` while the launch is still quick. */
  status: ReactNode;
}

/**
 * React twin of the `index.html` splash (same color, logo, and position) pinned to the
 * default theme. Children mount behind it with saved theme/locale, so the first frame the
 * user sees after it fades is final.
 */
export function AppBootCover({ done, status }: AppBootCoverProps) {
  const [fading, setFading] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!done) return;
    // `performance.now()` counts from page start, when the `index.html` splash paints.
    const wait = Math.max(0, BOOT_COVER_MIN_MS - performance.now());
    const id = window.setTimeout(() => setFading(true), wait);
    return () => window.clearTimeout(id);
  }, [done]);

  useEffect(() => {
    if (!fading) return;
    const id = window.setTimeout(() => setGone(true), BOOT_COVER_FADE_MS);
    return () => window.clearTimeout(id);
  }, [fading]);

  if (gone) return null;

  return (
    <div
      className={[
        "fixed inset-0 z-[150] bg-background transition-opacity ease-in",
        fading ? "pointer-events-none opacity-0" : "opacity-100",
      ].join(" ")}
      style={BOOT_THEME_STYLE}
      aria-busy={!fading}
    >
      <UprivAppIcon className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute inset-x-6 top-[calc(50%+4.5rem)] flex flex-col items-center gap-3 text-center">
        {status}
      </div>
    </div>
  );
}
