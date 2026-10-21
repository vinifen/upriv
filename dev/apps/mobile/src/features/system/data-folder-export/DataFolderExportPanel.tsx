import { StyleSheet, Text, View } from "react-native";
import {
  DATA_FOLDER_EXPORT_PROGRESS_COPY,
  DATA_FOLDER_ZIP_NAME_MAX_BYTES,
  LOADING_BUDGET_MS,
  dataFolderZipNameFromInput,
  dataFolderZipNameIssue,
  dataFolderZipNameIssueI18nKey,
  fileNameOfPath,
} from "@upriv/shared";
import { useLoadingBudget } from "@upriv/shared/react";
import { ExportFolderField } from "@/components/ExportFolderField";
import { FieldHint, FieldLabel, ThemedInput } from "@/components/settings";
import { JobProgressBar, LoadingBudgetHint } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import type {
  DataFolderExportControls,
  DataFolderExportDestination,
} from "./dataFolderExportTypes";

interface DataFolderExportPanelProps {
  controls: DataFolderExportControls;
  destination: DataFolderExportDestination;
}

/**
 * Body of the Export a copy option in Data folder: what the zip is called and
 * where it goes, then the running copy, and a saved line once this window saw
 * the zip written. The window footer starts and stops it.
 */
export function DataFolderExportPanel({ controls, destination }: DataFolderExportPanelProps) {
  const { job, written } = controls;
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const budget = useLoadingBudget(job !== null, LOADING_BUDGET_MS.dataFolderExport, {
    startedAt: job?.startedAt,
  });
  const nameIssue = dataFolderZipNameIssue(dataFolderZipNameFromInput(destination.zipName));
  const nameIssueKey = nameIssue ? dataFolderZipNameIssueI18nKey(nameIssue) : null;

  return (
    <View style={styles.body}>
      <Text style={typography.caption}>{t("modal.data_folder_export.hold_note")}</Text>
      {job ? (
        <View style={styles.group}>
          <JobProgressBar
            progress={job.progress}
            label={t("modal.data_folder_export.title")}
            copy={DATA_FOLDER_EXPORT_PROGRESS_COPY}
          />
          <Text style={typography.caption}>{t("modal.data_folder_export.background_note")}</Text>
          {budget.visible ? (
            <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
          ) : null}
        </View>
      ) : (
        <>
          <View style={styles.group}>
            <FieldLabel>{t("modal.data_folder_export.name_label")}</FieldLabel>
            <FieldHint>{t("modal.data_folder_export.name_hint")}</FieldHint>
            <View style={styles.nameRow}>
              <ThemedInput
                mono
                value={destination.zipName}
                maxLength={DATA_FOLDER_ZIP_NAME_MAX_BYTES}
                accessibilityLabel={t("modal.data_folder_export.name_label")}
                aria-invalid={nameIssueKey ? true : undefined}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                onChangeText={destination.setZipName}
                style={styles.nameInput}
              />
              <Text style={[typography.mono, { color: colors.onSurfaceVariant }]}>.zip</Text>
            </View>
            {nameIssueKey ? (
              <Text
                accessibilityRole="alert"
                style={[typography.caption, { color: colors.onErrorContainer }]}
              >
                {t(nameIssueKey)}
              </Text>
            ) : null}
          </View>
          <ExportFolderField folder={destination.folder} />
          {written ? (
            <Text
              accessibilityRole="text"
              style={[typography.body, { color: colors.vaultStatusOpen }]}
            >
              {t("modal.data_folder_export.done", { name: fileNameOfPath(written.path) })}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.sm },
  group: { gap: spacing.sm },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  nameInput: { flex: 1, minWidth: 0 },
});
