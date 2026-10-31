import { useCallback, useEffect, useRef, useState } from "react";
import { exportFolderIssue } from "../domain";

/** What the step needs from a platform's export folder field. */
export interface BackupExportFolder {
  path: string;
  picking: boolean;
  /**
   * While no usable folder is set, opens the picker and answers `true`.
   * `onPicked` runs with the folder the picker answers with.
   */
  chooseIfMissing: (onPicked?: (folder: string) => void) => boolean;
  /** A pick still open is let go when it answers. */
  cancelPick: () => void;
}

export interface UseBackupExportStepOptions {
  folder: BackupExportFolder;
  /** The Backups window is up. */
  open: boolean;
  /** Keys of the backups listed now: a step for one that left the list ends. */
  listed: readonly string[];
  /** A backup export is running, of any vault. */
  busy: boolean;
  onBusy: () => void;
  /** Export these backups into `destDir`. */
  onStart: (keys: readonly string[], destDir: string) => void;
}

/**
 * The folder step of a backup export in the Backups window. `begin` shows the
 * step for its backups and, while no folder is kept, opens the picker. A
 * folder from the picker starts the export at once. A kept or typed folder
 * waits for `confirm`, so the person sees where the file goes.
 */
export function useBackupExportStep({
  folder,
  open,
  listed,
  busy,
  onBusy,
  onStart,
}: UseBackupExportStepOptions) {
  const [keys, setKeys] = useState<readonly string[] | null>(null);
  const folderRef = useRef(folder);
  folderRef.current = folder;
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;
  const { cancelPick } = folder;

  const start = useCallback((chosen: readonly string[], destDir: string) => {
    setKeys(null);
    onStartRef.current(chosen, destDir);
  }, []);

  const begin = useCallback(
    (chosen: readonly string[]) => {
      if (chosen.length === 0) return;
      if (busy) {
        onBusy();
        return;
      }
      setKeys(chosen);
    },
    [busy, onBusy],
  );

  /** Export into the folder in the field. Waits while it is missing or a pick is open. */
  const confirm = useCallback(() => {
    const { path, picking } = folderRef.current;
    if (keys === null || picking || exportFolderIssue(path) !== null) return;
    start(keys, path.trim());
  }, [keys, start]);

  const cancel = useCallback(() => {
    setKeys(null);
    cancelPick();
  }, [cancelPick]);

  /** The field's own Choose folder answered. */
  const picked = useCallback(
    (destDir: string) => {
      if (keys !== null) start(keys, destDir);
    },
    [keys, start],
  );

  // After the step renders, so the field is there to type in when a pick is cancelled.
  useEffect(() => {
    if (keys === null) return;
    folderRef.current.chooseIfMissing((destDir) => start(keys, destDir));
  }, [keys, start]);

  useEffect(() => {
    if (open) return;
    setKeys(null);
    cancelPick();
  }, [cancelPick, open]);

  useEffect(() => {
    setKeys((current) =>
      current !== null && current.some((key) => !listed.includes(key)) ? null : current,
    );
  }, [listed]);

  return { keys, begin, confirm, cancel, picked };
}
