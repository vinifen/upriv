import { useEffect, useMemo } from "react";
import { isRpcError, treeFolderPresence, VAULT_ERROR_CODES, type FileTreeNode } from "../domain";
import { scheduleInterval } from "./schedule";

/** The folder fills in the background and other apps change it, so no call reports either. */
const FOLDER_POLL_MS = 2000;

/**
 * What a vault of chosen files has in its folder, by path; null for any other
 * vault. While it applies, `syncTree` runs on a timer so the marks follow the
 * folder. A poll that fails waits for the next one. Once core says the vault
 * is not open (a close took its session, while the row still shows it
 * closing), polling ends.
 */
export function useTreeFolderPresence(tree: FileTreeNode, syncTree: () => Promise<void>) {
  const presence = useMemo(() => treeFolderPresence(tree), [tree]);
  const chosenFiles = presence !== null;

  useEffect(() => {
    if (!chosenFiles) return;
    const stop = scheduleInterval(() => {
      syncTree().catch((error: unknown) => {
        if (isRpcError(error) && error.code === VAULT_ERROR_CODES.VAULT_NOT_OPEN) stop();
      });
    }, FOLDER_POLL_MS);
    return stop;
  }, [chosenFiles, syncTree]);

  return presence;
}
