import { useEffect, useRef } from "react";

/**
 * When `active` turns true, scrolls the element fully into view and focuses its
 * first input. Focus uses `preventScroll` so the whole block (e.g. input plus
 * confirm buttons) lands in view, not just the input.
 */
export function useRevealWhen<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    el.querySelector<HTMLInputElement>("input:not([disabled])")?.focus({ preventScroll: true });
  }, [active]);

  return ref;
}
