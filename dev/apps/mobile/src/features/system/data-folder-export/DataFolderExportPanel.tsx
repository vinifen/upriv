import { StyleSheet, Text, View } from "react-native";
import {
  DATA_FOLDER_ZIP_NAME_MAX_BYTES,
  LOADING_BUDGET_MS,
  dataFolderZipName,
  dataFolderZipNameFromInput,
  dataFolderZipNameIssue,
  dataFolderZipNameIssueI18nKey,
  formatBytes,
  jobProgressFinishing,
  jobProgressPercent,
} from "@upriv/shared";
import { useLoadingBudget } from "@upriv/shared/react";
import { PathField } from "@/components/PathField";
import { FieldHint, FieldLabel, ThemedInput } from "@/components/settings";
import { Button, LoadingBudgetHint } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { radii, spacing } from "@/theme/tokens";
import type {
  DataFolderExportControls,
  DataFolderExportDestination,
} from "./dataFolderExportTypes";

interface DataFolderExportPanelProps {
  controls: DataFolderExportControls;
  destination: DataFolderExportDestination;
}

/**
 * Body of the Export a copy option in Data folder, shown once it is chosen:
 * what the zip is called and where it goes, then the running copy. The window
 * footer starts and stops it.
 */
export function DataFolderExportPanel({ controls, destination }: DataFolderExportPanelProps) {
  const { job, written } = controls;
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const budget = useLoadingBudget(job !== null, LOADING_BUDGET_MS.dataFolderExport, {
    startedAt: job?.startedAt,
  });
  const progress = job?.progress ?? null;
  const percent = jobProgressPercent(progress);
  const nameIssue = dataFolderZipNameIssue(dataFolderZipNameFromInput(destination.zipName));
  const nameIssueKey = nameIssue ? dataFolderZipNameIssueI18nKey(nameIssue) : null;

  const progressLine = () => {
    if (jobProgressFinishing(progress)) return t("modal.data_folder_export.finishing");
    if (progress && progress.bytesTotal > 0) {
      return t("modal.data_folder_export.progress", {
        done: formatBytes(progress.bytesDone),
        total: formatBytes(progress.bytesTotal),
      });
    }
    return t("modal.data_folder_export.measuring");
  };

  return (
    <View style={styles.body}>
      <Text style={typography.caption}>{t("modal.data_folder_export.hold_note")}</Text>
      {job ? (
        <View style={styles.group}>
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={t("modal.data_folder_export.title")}
            accessibilityValue={percent === null ? undefined : { min: 0, max: 100, now: percent }}
            style={[styles.track, { backgroundColor: colors.surfaceContainerHighest }]}
          >
            <View
              style={[
                styles.fill,
                { backgroundColor: colors.accent },
                percent === null ? styles.fillMeasuring : { width: `${percent}%` },
              ]}
            />
          </View>
          <Text style={[typography.body, { color: colors.onSurface }]}>{progressLine()}</Text>
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
          <View style={styles.group}>
            <FieldLabel>{t("modal.data_folder_export.folder_label")}</FieldLabel>
            <PathField
              value={destination.destDir ?? ""}
              editable={false}
              placeholder={t("modal.data_folder_export.folder_none")}
            />
            <Button
              size="sm"
              variant="ghost"
              label={t("modal.data_folder_export.choose_folder")}
              disabled={destination.picking}
              busy={destination.picking}
              onPress={destination.choose}
            />
          </View>
          {destination.pickFailed ? (
            <Text
              accessibilityRole="alert"
              style={[typography.caption, { color: colors.onErrorContainer }]}
            >
              {t("error.unexpected")}
            </Text>
          ) : null}
          {written ? (
            <View style={styles.group}>
              <Text style={[typography.body, { color: colors.vaultStatusOpen }]}>
                {t("modal.data_folder_export.done", {
                  name: dataFolderZipName(written.result.path),
                })}
              </Text>
              {/* A picked tree is a storage-access grant, not a location the
                  Files app opens: no open button. */}
              <PathField value={written.destDir} openPath="" editable={false} />
            </View>
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
  track: {
    height: spacing.sm,
    borderRadius: radii.full,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: radii.full },
  fillMeasuring: { width: "25%", opacity: 0.5 },
});
