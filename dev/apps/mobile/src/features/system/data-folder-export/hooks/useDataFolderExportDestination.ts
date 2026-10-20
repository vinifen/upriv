import { useCallback, useEffect, useRef, useState } from "react";
import { dataFolderZipDefaultName } from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { useDataFolderService, useVaultRootService } from "@/platform/services";
import { createDestinationGrant } from "../destinationGrant";
import type { DataFolderExportDestination } from "../dataFolderExportTypes";

/**
 * A picked folder holds a storage-access grant. It stays for the next export
 * while the window is open, and is let go when another is picked, when the
 * window closes, and when the vault list goes away; the service waits for an
 * export still using it. A pick that answers after the window closed is let go
 * at once. Phone folders come from the picker only: a typed path is not a grant.
 */
export function useDataFolderExportDestination(): DataFolderExportDestination {
  const { t } = useTranslation();
  const vaultRoot = useVaultRootService();
  const dataFolder = useDataFolderService();
  const dataFolderRef = useRef(dataFolder);
  dataFolderRef.current = dataFolder;
  const [grant] = useState(() =>
    createDestinationGrant((uri) => dataFolderRef.current?.releaseDestination?.(uri)),
  );
  const [destDir, setDestDir] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickFailed, setPickFailed] = useState(false);
  const [zipName, setZipName] = useState(() => dataFolderZipDefaultName(new Date()));
  /** Bumped by `clear`, so a pick still open when the window closed is not kept. */
  const pickGen = useRef(0);

  useEffect(() => () => grant.clear(), [grant]);

  const choose = useCallback(() => {
    const gen = pickGen.current;
    setPicking(true);
    setPickFailed(false);
    void vaultRoot
      .pickFolder(grant.held(), t("modal.data_folder_export.picker_title"))
      .then((picked) => {
        const folder = picked?.trim();
        if (!folder) return;
        if (gen !== pickGen.current) {
          dataFolderRef.current?.releaseDestination?.(folder);
          return;
        }
        grant.pick(folder);
        setDestDir(folder);
      })
      .catch(() => {
        if (gen === pickGen.current) setPickFailed(true);
      })
      .finally(() => setPicking(false));
  }, [grant, t, vaultRoot]);

  const clear = useCallback(() => {
    pickGen.current += 1;
    grant.clear();
    setDestDir(null);
    setPickFailed(false);
  }, [grant]);

  const resetZipName = useCallback(() => setZipName(dataFolderZipDefaultName(new Date())), []);

  return {
    destDir,
    picking,
    pickFailed,
    choose,
    clear,
    zipName,
    setZipName,
    resetZipName,
  };
}
