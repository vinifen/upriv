import { useCallback, useState } from "react";
import { dataFolderZipDefaultName } from "@upriv/shared";
import { useExportFolder } from "@/hooks/useExportFolder";
import { useTranslation } from "@/i18n";
import type { DataFolderExportDestination } from "../dataFolderExportTypes";

/**
 * The folder is a path the person types or picks. It stays while the vault
 * list is up, across exports and when the window closes. The name starts as
 * `upriv-<UTC stamp>` and starts over when asked.
 */
export function useDataFolderExportDestination(): DataFolderExportDestination {
  const { t } = useTranslation();
  const folder = useExportFolder(t("modal.data_folder_export.picker_title"));
  const [zipName, setZipName] = useState(() => dataFolderZipDefaultName(new Date()));

  const resetZipName = useCallback(() => setZipName(dataFolderZipDefaultName(new Date())), []);

  return { folder, zipName, setZipName, resetZipName };
}
