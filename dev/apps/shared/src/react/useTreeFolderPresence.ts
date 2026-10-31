import { useEffect, useMemo } from "react";
import { treeFolderPresence, type FileTreeNode } from "../domain";
import { scheduleInterval } from "./schedule";

/** The folder fills in the background and other apps change it, so no call reports either. */
const FOLDER_POLL_MS = 2000;

/**
 * What a vault of chosen files has in its folder, by path; null for any other
 * vault. While it applies, `syncTree` runs on a timer so the marks follow the
 * folder. A poll that fails waits for the next one.
 */
export function useTreeFolderPresence(tree: FileTreeNode, syncTree: () => Promise<void>) {
  const presence = useMemo(() => treeFolderPresence(tree), [tree]);
  const chosenFiles = presence !== null;

  useEffect(() => {
    if (!chosenFiles) return;
    return scheduleInterval(() => {
      syncTree().catch(() => undefined);
    }, FOLDER_POLL_MS);
  }, [chosenFiles, syncTree]);

  return presence;
}
