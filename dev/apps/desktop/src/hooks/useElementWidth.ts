import { useLayoutEffect, useState, type RefObject } from "react";

/** Observe an element's content width (vault row chrome follows the row, not the window). */
export function useElementWidth(ref: RefObject<HTMLElement | null>, initialWidth: number): number {
  const [width, setWidth] = useState(initialWidth);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const apply = () => {
      const next = el.getBoundingClientRect().width;
      if (next > 0) setWidth(next);
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
