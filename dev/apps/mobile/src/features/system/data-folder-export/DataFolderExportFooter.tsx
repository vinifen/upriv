import { Button, JobStopButton } from "@/components/ui";
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
        <JobStopButton
          stoppingSince={job.stoppingSince}
          stoppable={job.progress?.stoppable ?? true}
          onStop={onStop}
          label={t("modal.data_folder_export.stop")}
          stoppingLabel={t("modal.data_folder_export.stopping")}
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
