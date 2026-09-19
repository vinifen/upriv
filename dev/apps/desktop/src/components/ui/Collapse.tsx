import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { GROUP_COLLAPSE_MS, GROUP_EXPAND_MS } from "@upriv/shared";

interface CollapseProps {
  open: boolean;
  children: ReactNode;
  className?: string;
  /** Expand duration (default `GROUP_EXPAND_MS`). */
  openMs?: number;
  /** Collapse duration (default `GROUP_COLLAPSE_MS`). */
  closeMs?: number;
}

/**
 * Height expand/collapse via `grid-template-rows` (0fr ↔ 1fr), then `auto` once
 * open so live field errors can grow the panel. `overflow: hidden` only while
 * animating — a settled `1fr` + clip would hide content that appears later.
 * `min-width: 0` so nested vault rows shrink to the group instead of overflowing.
 * Callers must keep real content as `children` while this is mounted —
 * do not empty children when `open` flips false (that collapses height instantly).
 */
export function Collapse({
  open,
  children,
  className = "",
  openMs = GROUP_EXPAND_MS,
  closeMs = GROUP_COLLAPSE_MS,
}: CollapseProps) {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (open) {
      setMounted(true);
      if (reduce) {
        setExpanded(true);
        setSettled(true);
        return;
      }
      setSettled(false);
      // Two frames: mount at 0fr, then expand so the browser interpolates height.
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setExpanded(true));
      });
      const done = window.setTimeout(() => setSettled(true), openMs);
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
        window.clearTimeout(done);
      };
    }

    if (reduce) {
      setSettled(false);
      setExpanded(false);
      setMounted(false);
      return;
    }
    // Snap auto → 1fr (no interpolation), then 1fr → 0fr next frames.
    setSettled(false);
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setExpanded(false));
    });
    const id = window.setTimeout(() => setMounted(false), closeMs);
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      window.clearTimeout(id);
    };
  }, [open, closeMs, openMs]);

  if (!mounted) return null;

  const durationMs = expanded ? openMs : closeMs;
  const style: CSSProperties = {
    display: "grid",
    gridTemplateRows: !expanded ? "0fr" : settled ? "auto" : "1fr",
    transitionProperty: settled ? "none" : "grid-template-rows",
    transitionDuration: `${durationMs}ms`,
    transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
    // Match mobile Collapse: ignore hits while closing (still painted during height anim).
    pointerEvents: open ? "auto" : "none",
  };

  return (
    <div
      className={["min-w-0 motion-reduce:!transition-none", className].filter(Boolean).join(" ")}
      style={style}
      aria-hidden={!open}
    >
      <div className={settled && expanded ? "min-h-0 min-w-0" : "min-h-0 min-w-0 overflow-hidden"}>
        {children}
      </div>
    </div>
  );
}
