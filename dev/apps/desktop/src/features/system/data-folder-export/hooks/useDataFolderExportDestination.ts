import { useCallback, useRef, useState } from "react";
import { dataFolderZipDefaultName } from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { useVaultRootService } from "@/platform/services";
import type { DataFolderExportDestination } from "../dataFolderExportTypes";

/**
 * Desktop folders hold no grant, so the folder is a path the person types or
 * picks. A pick that answers after the window closed is dropped.
 */
export function useDataFolderExportDestination(): DataFolderExportDestination {
  const { t } = useTranslation();
  const vaultRoot = useVaultRootService();
  const [destDir, setDestDirState] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickFailed, setPickFailed] = useState(false);
  const [zipName, setZipName] = useState(() => dataFolderZipDefaultName(new Date()));
  const destDirRef = useRef(destDir);
  destDirRef.current = destDir;
  /** Bumped by `clear`, so a pick still open when the window closed is not kept. */
  const pickGen = useRef(0);

  const setDestDir = useCallback((path: string) => {
    setDestDirState(path);
    setPickFailed(false);
  }, []);

  const choose = useCallback(() => {
    const gen = pickGen.current;
    setPicking(true);
    setPickFailed(false);
    void vaultRoot
      .pickFolder(destDirRef.current?.trim() || null, t("modal.data_folder_export.picker_title"))
      .then((picked) => {
        const folder = picked?.trim();
        if (folder && gen === pickGen.current) setDestDirState(folder);
      })
      .catch(() => {
        if (gen === pickGen.current) setPickFailed(true);
      })
      .finally(() => setPicking(false));
  }, [t, vaultRoot]);

  const clear = useCallback(() => {
    pickGen.current += 1;
    setDestDirState(null);
    setPickFailed(false);
  }, []);

  const resetZipName = useCallback(() => setZipName(dataFolderZipDefaultName(new Date())), []);

  return {
    destDir,
    setDestDir,
    picking,
    pickFailed,
    choose,
    clear,
    zipName,
    setZipName,
    resetZipName,
  };
}
