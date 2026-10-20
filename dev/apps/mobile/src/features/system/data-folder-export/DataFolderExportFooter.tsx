import { dataFolderExportPending, dataFolderZipNameFromInput } from "@upriv/shared";
import { Button } from "@/components/ui";
import { ModalFooterActions, modalFooterConfirmBtnStyle } from "@/components/ui/ModalFooterActions";
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
    <ModalFooterActions layout="confirm">
      {job ? (
        <Button
          variant="secondary"
          label={
            job.stopping
              ? t("modal.data_folder_export.stopping")
              : t("modal.data_folder_export.stop")
          }
          style={modalFooterConfirmBtnStyle}
          disabled={job.stopping}
          busy={job.stopping}
          onPress={onStop}
        />
      ) : (
        <Button
          variant="primary"
          label={t("modal.data_folder_export.confirm")}
          style={modalFooterConfirmBtnStyle}
          disabled={!ready}
          onPress={start}
        />
      )}
    </ModalFooterActions>
  );
}
