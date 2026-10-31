import { StyleSheet, Text, View } from "react-native";
import { exportFolderIssue, LOADING_BUDGET_MS, VAULT_EXPORT_PROGRESS_COPY } from "@upriv/shared";
import { useLoadingBudget, type BackupExportJob } from "@upriv/shared/react";
import { ExportFolderField } from "@/components/ExportFolderField";
import { Button, JobProgressBar, LoadingBudgetHint, ModalFooterActions } from "@/components/ui";
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
          label={t("vault.export.dialog.confirm")}
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

/** How far this export got, how long it may still take, and its stop. */
export function BackupExportProgress({ job, title, onStop }: BackupExportProgressProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  const budget = useLoadingBudget(true, LOADING_BUDGET_MS.backupExport, {
    startedAt: job.startedAt,
  });

  return (
    <View style={styles.panel}>
      {title ? <Text style={[typography.body, styles.title]}>{title}</Text> : null}
      <JobProgressBar
        progress={job.progress}
        label={t("vault.export.dialog.title")}
        copy={VAULT_EXPORT_PROGRESS_COPY}
      />
      <Text style={typography.caption}>{t("vault.export.dialog.background_note")}</Text>
      {budget.visible ? (
        <LoadingBudgetHint
          budgetMs={budget.budgetMs}
          remainingMs={budget.remainingMs}
          layout="inline"
        />
      ) : null}
      <ModalFooterActions layout="dialog">
        <Button
          label={job.stopping ? t("vault.export.dialog.stopping") : t("vault.export.dialog.stop")}
          variant="secondary"
          size="sm"
          disabled={job.stopping}
          busy={job.stopping}
          onPress={onStop}
        />
      </ModalFooterActions>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.sm },
  title: { fontWeight: "500" },
});
