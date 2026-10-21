import { useCallback, useRef, useState } from "react";
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
  /** Opens the folder picker. Only the field's Choose folder button calls it. */
  choose: () => void;
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
  /** Bumped by `cancelPick`, so a pick still open when the window closed is not kept. */
  const pickGen = useRef(0);

  const setPath = useCallback((next: string) => {
    setPathState(next);
    setPickFailed(false);
  }, []);

  const choose = useCallback(() => {
    const gen = pickGen.current;
    setPicking(true);
    setPickFailed(false);
    void vaultRoot
      .pickFolder(pathRef.current.trim() || null, pickerTitle)
      .then((picked) => {
        const folder = picked?.trim();
        if (folder && gen === pickGen.current) setPathState(folder);
      })
      .catch(() => {
        if (gen === pickGen.current) setPickFailed(true);
      })
      .finally(() => setPicking(false));
  }, [pickerTitle, vaultRoot]);

  const cancelPick = useCallback(() => {
    pickGen.current += 1;
    setPickFailed(false);
  }, []);

  return { path, setPath, picking, pickFailed, choose, cancelPick };
}
