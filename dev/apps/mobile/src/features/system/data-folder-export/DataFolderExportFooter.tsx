import { Button } from "@/components/ui";
import { ModalFooterActions } from "@/components/ui/ModalFooterActions";
import { useTranslation } from "@/i18n";
import type {
  DataFolderExportControls,
  DataFolderExportDestination,
} from "./dataFolderExportTypes";
import { dataFolderExportReady, startDataFolderExport } from "./startDataFolderExport";

interface DataFolderExportFooterProps {
  controls: DataFolderExportControls;
  destination: DataFolderExportDestination;
}

/** Data folder footer while Export a copy is chosen: Export, or Stop export while it runs. */
export function DataFolderExportFooter({ controls, destination }: DataFolderExportFooterProps) {
  const { job, onStop } = controls;
  const { t } = useTranslation();
  const ready = dataFolderExportReady(controls, destination);
  const start = () => startDataFolderExport(controls, destination);

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
          disabled={job.stopping}
          busy={job.stopping}
          onPress={onStop}
        />
      ) : (
        <Button
          variant="primary"
          label={t("modal.data_folder_export.confirm")}
          disabled={!ready}
          onPress={start}
        />
      )}
    </ModalFooterActions>
  );
}
