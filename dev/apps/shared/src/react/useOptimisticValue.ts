import { useCallback, useRef, useState } from "react";

/**
 * A saved value the screen shows changed at once while its save runs, so a
 * toggle never waits on the disk. Once the latest save ends, the saved value
 * shows again: the new one after a save, the old one after a failure.
 */
export function useOptimisticValue<T>(
  saved: T,
  save: (next: T) => Promise<unknown>,
): [T, (next: T) => void] {
  const [pending, setPending] = useState<{ value: T } | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const generationRef = useRef(0);

  const set = useCallback((next: T) => {
    const generation = ++generationRef.current;
    setPending({ value: next });
    // An earlier save ending must not show its value over a later choice.
    const settle = () => {
      if (generationRef.current === generation) setPending(null);
    };
    void saveRef.current(next).then(settle, settle);
  }, []);

  return [pending ? pending.value : saved, set];
}
