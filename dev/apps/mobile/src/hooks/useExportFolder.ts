import { useCallback, useEffect, useRef, useState } from "react";
import { createExportFolderHold } from "@/lib/exportFolderHold";
import { useExportFolderGrants, useVaultRootService } from "@/platform/services";

/**
 * A folder an export writes into. A phone folder comes from the picker only:
 * it is a storage-access grant, and a typed path is not one.
 */
export interface ExportFolder {
  /** The picked folder; empty until one is chosen. */
  path: string;
  picking: boolean;
  pickFailed: boolean;
  /** Opens the folder picker. Only the field's Choose folder button calls it. */
  choose: () => void;
  /** The window closed: a pick still open is let go when it answers. The folder stays. */
  cancelPick: () => void;
}

/**
 * State of one export folder field. The picked folder keeps its grant while
 * its owner is mounted, also when the window closes, and lets it go when
 * another is picked or the owner goes away. `pickerTitle` names the folder in
 * the picker.
 */
export function useExportFolder(pickerTitle: string): ExportFolder {
  const vaultRoot = useVaultRootService();
  const grants = useExportFolderGrants();
  const [hold] = useState(() => createExportFolderHold(grants));
  const [path, setPath] = useState("");
  const [picking, setPicking] = useState(false);
  const [pickFailed, setPickFailed] = useState(false);
  /** Bumped by `cancelPick`, so a pick still open when the window closed is not kept. */
  const pickGen = useRef(0);

  useEffect(() => () => hold.clear(), [hold]);

  const choose = useCallback(() => {
    const gen = pickGen.current;
    setPicking(true);
    setPickFailed(false);
    void vaultRoot
      .pickFolder(hold.held(), pickerTitle)
      .then((picked) => {
        const folder = picked?.trim();
        if (!folder) return;
        if (gen !== pickGen.current) {
          hold.drop(folder);
          return;
        }
        hold.pick(folder);
        setPath(folder);
      })
      .catch(() => {
        if (gen === pickGen.current) setPickFailed(true);
      })
      .finally(() => setPicking(false));
  }, [hold, pickerTitle, vaultRoot]);

  const cancelPick = useCallback(() => {
    pickGen.current += 1;
    setPickFailed(false);
  }, []);

  return { path, picking, pickFailed, choose, cancelPick };
}
