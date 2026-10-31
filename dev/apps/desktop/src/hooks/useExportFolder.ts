import { useCallback, useRef, useState, type RefObject } from "react";
import { exportFolderIssue } from "@upriv/shared";
import { useVaultRootService } from "@/platform/services";

/**
 * A folder an export writes into. Desktop folders hold no grant, so this is a
 * path the person types or picks. It stays while its owner is mounted.
 */
export interface ExportFolder {
  /** As typed or picked; empty until chosen. Trimmed only when it is sent. */
  path: string;
  /** Typed into the folder field. */
  setPath: (path: string) => void;
  picking: boolean;
  pickFailed: boolean;
  /** The folder field's text input, for `chooseIfMissing`. */
  fieldRef: RefObject<HTMLInputElement>;
  /**
   * Opens the folder picker: the field's Choose folder button. `onPicked` runs
   * with the folder when the picker answers with one.
   */
  choose: (onPicked?: (folder: string) => void) => void;
  /**
   * Enter in the field before this one. While no usable folder is set, it
   * focuses the folder field, opens the picker, and answers `true`. Once a
   * folder is set it answers `false`, so Enter goes on to Export.
   */
  chooseIfMissing: (onPicked?: (folder: string) => void) => boolean;
  /** The window closed: a pick still open is not kept. The folder stays. */
  cancelPick: () => void;
}

/**
 * State of one export folder field. `pickerTitle` names the folder in the
 * picker. A pick that answers after `cancelPick` is dropped.
 */
export function useExportFolder(pickerTitle: string): ExportFolder {
  const vaultRoot = useVaultRootService();
  const [path, setPathState] = useState("");
  const [picking, setPicking] = useState(false);
  const [pickFailed, setPickFailed] = useState(false);
  const pathRef = useRef(path);
  pathRef.current = path;
  const fieldRef = useRef<HTMLInputElement>(null);
  /** One picker at a time, also between a press and the render that disables the button. */
  const pickOpen = useRef(false);
  /** Bumped by `cancelPick`, so a pick still open when the window closed is not kept. */
  const pickGen = useRef(0);

  const setPath = useCallback((next: string) => {
    setPathState(next);
    setPickFailed(false);
  }, []);

  const choose = useCallback(
    (onPicked?: (folder: string) => void) => {
      if (pickOpen.current) return;
      pickOpen.current = true;
      const gen = pickGen.current;
      setPicking(true);
      setPickFailed(false);
      void vaultRoot
        .pickFolder(pathRef.current.trim() || null, pickerTitle)
        .then((picked) => {
          const folder = picked?.trim();
          if (!folder || gen !== pickGen.current) return;
          setPathState(folder);
          onPicked?.(folder);
        })
        .catch(() => {
          if (gen === pickGen.current) setPickFailed(true);
        })
        .finally(() => {
          pickOpen.current = false;
          setPicking(false);
        });
    },
    [pickerTitle, vaultRoot],
  );

  const chooseIfMissing = useCallback(
    (onPicked?: (folder: string) => void) => {
      if (exportFolderIssue(pathRef.current) === null) return false;
      fieldRef.current?.focus();
      choose(onPicked);
      return true;
    },
    [choose],
  );

  const cancelPick = useCallback(() => {
    pickGen.current += 1;
    setPickFailed(false);
  }, []);

  return { path, setPath, picking, pickFailed, fieldRef, choose, chooseIfMissing, cancelPick };
}
