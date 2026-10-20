import { dataFolderExportPending, dataFolderZipNameFromInput } from "@upriv/shared";
import { Button } from "@/components/ui";
import { useTranslation } from "@/i18n";
import type {
  DataFolderExportControls,
  DataFolderExportDestination,
} from "./dataFolderExportTypes";

interface DataFolderExportFooterProps {
  controls: DataFolderExportControls;
  destination: DataFolderExportDestination;
}

/** Data folder footer while Export a copy is chosen: Export, or Stop export while it runs. */
export function DataFolderExportFooter({ controls, destination }: DataFolderExportFooterProps) {
  const { canStart, job, onStart, onStop } = controls;
  const { t } = useTranslation();
  const ready =
    canStart &&
    !destination.picking &&
    dataFolderExportPending(destination.destDir, destination.zipName) === null;

  // The folder stays chosen for the next export; the name starts over once this one is written.
  const start = () => {
    const folder = destination.destDir?.trim();
    if (ready && folder) onStart(folder, dataFolderZipNameFromInput(destination.zipName));
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row-reverse sm:flex-wrap sm:justify-start [&_button]:w-full sm:[&_button]:w-auto">
      {job ? (
        <Button variant="secondary" size="md" disabled={job.stopping} onClick={onStop}>
          {job.stopping
            ? t("modal.data_folder_export.stopping")
            : t("modal.data_folder_export.stop")}
        </Button>
      ) : (
        <Button variant="primary" size="md" disabled={!ready} onClick={start}>
          {t("modal.data_folder_export.confirm")}
        </Button>
      )}
    </div>
  );
}
