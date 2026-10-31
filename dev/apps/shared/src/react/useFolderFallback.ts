import { useCallback, useEffect, useRef } from "react";
import type { FolderPresence } from "../domain";

/**
 * The way out for a file too large for the viewer: a file the person opened
 * goes to the plain-text folder, where another app can open it from the disk.
 * A tab restored with the vault stays out, so opening a vault writes nothing.
 * Returns the mark to call when the person opens a file.
 */
export function useFolderFallback(
  activePath: string | null,
  tooLarge: boolean,
  presence: ReadonlyMap<string, FolderPresence> | null,
  send: (path: string) => unknown,
) {
  const openedRef = useRef(new Set<string>());
  const missing = activePath !== null && tooLarge && presence?.get(activePath) === "none";

  useEffect(() => {
    if (missing && activePath && openedRef.current.delete(activePath)) send(activePath);
  }, [activePath, missing, send]);

  return useCallback((path: string) => {
    openedRef.current.add(path);
  }, []);
}
