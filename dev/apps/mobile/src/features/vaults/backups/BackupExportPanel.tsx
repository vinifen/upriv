import { StyleSheet, Text, View } from "react-native";
import { BACKUP_EXPORT_PROGRESS_COPY, exportFolderIssue } from "@upriv/shared";
import type { BackupExportJob } from "@upriv/shared/react";
import { ExportFolderField } from "@/components/ExportFolderField";
import { Button, JobProgressBar, JobStopButton, ModalFooterActions } from "@/components/ui";
import type { ExportFolder } from "@/hooks/useExportFolder";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";

interface BackupExportFolderStepProps {
  folder: ExportFolder;
  /** Under the field's label: the file this export writes there. */
  hint: string;
  /** Names the backups when several go together. */
  title?: string;
  onConfirm: () => void;
  onCancel: () => void;
  onPicked: (folder: string) => void;
}

/** Where this export goes. A folder from the picker starts it; a kept one waits. */
export function BackupExportFolderStep({
  folder,
  hint,
  title,
  onConfirm,
  onCancel,
  onPicked,
}: BackupExportFolderStepProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  const ready = !folder.picking && exportFolderIssue(folder.path) === null;

  return (
    <View style={styles.panel}>
      {title ? <Text style={[typography.body, styles.title]}>{title}</Text> : null}
      <ExportFolderField folder={folder} hint={hint} onPicked={onPicked} />
      <ModalFooterActions layout="dialog">
        <Button label={t("action.cancel")} variant="ghost" size="sm" onPress={onCancel} />
        <Button
          label={t("modal.backup.export_confirm")}
          variant="primary"
          size="sm"
          disabled={!ready}
          onPress={onConfirm}
        />
      </ModalFooterActions>
    </View>
  );
}

interface BackupExportProgressProps {
  job: BackupExportJob;
  /** Names the backups when several go together. */
  title?: string;
  onStop: () => void;
}

/** How far this export got, how long it has run, and its stop. */
export function BackupExportProgress({ job, title, onStop }: BackupExportProgressProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();

  return (
    <View style={styles.panel}>
      {title ? <Text style={[typography.body, styles.title]}>{title}</Text> : null}
      <JobProgressBar
        progress={job.progress}
        startedAt={job.startedAt}
        label={t("modal.backup.export")}
        copy={BACKUP_EXPORT_PROGRESS_COPY}
      />
      <Text style={typography.caption}>{t("modal.backup.export_background_note")}</Text>
      <ModalFooterActions layout="dialog">
        <JobStopButton
          size="sm"
          stoppingSince={job.stoppingSince}
          stoppable={job.progress?.stoppable ?? true}
          onStop={onStop}
          label={t("modal.backup.export_stop")}
          stoppingLabel={t("modal.backup.export_stopping")}
        />
      </ModalFooterActions>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.sm },
  title: { fontWeight: "500" },
});
