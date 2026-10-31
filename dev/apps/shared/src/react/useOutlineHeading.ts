import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The outline entry marked as current. Scrolling marks the heading at the top
 * (`follow`). A heading picked in the outline (`pick`) stays marked while its
 * jump scrolls past the others, so the mark and the outline list do not jump
 * back and forth; scrolling by hand (`release`) hands the mark back to the
 * scroll. A new `resetKey` (another file) starts at the first heading.
 */
export function useOutlineHeading(resetKey: unknown) {
  const [index, setIndex] = useState(0);
  const pickedRef = useRef(false);

  useEffect(() => {
    pickedRef.current = false;
    setIndex(0);
  }, [resetKey]);

  const pick = useCallback((next: number) => {
    pickedRef.current = true;
    setIndex(next);
  }, []);

  const follow = useCallback((next: number) => {
    if (!pickedRef.current) setIndex(next);
  }, []);

  const release = useCallback(() => {
    pickedRef.current = false;
  }, []);

  return { index, pick, follow, release };
}
