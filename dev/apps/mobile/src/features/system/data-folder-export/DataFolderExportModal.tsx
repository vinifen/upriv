import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LOADING_BUDGET_MS, dataFolderExportPercent, formatBytes } from "@upriv/shared";
import { useLoadingBudget, type DataFolderExportJob } from "@upriv/shared/react";
import { PathField } from "@/components/PathField";
import { FieldHint, FieldLabel } from "@/components/settings";
import { Button, LoadingBudgetHint, Modal, ModalFooterActions } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useDataFolderService, useVaultRootService } from "@/platform/services";
import { useTheme } from "@/theme";
import { radii, spacing } from "@/theme/tokens";

/** The zip the last export wrote, and the folder it landed in. */
export interface DataFolderExportWritten {
  name: string;
  folder: string;
}

interface DataFolderExportModalProps {
  open: boolean;
  /** Every vault is closed or in recovery and no vault work runs (`dataFolderCanExport`). */
  canStart: boolean;
  /** The export in flight. The vault list keeps it while this window is closed. */
  job: DataFolderExportJob | null;
  /** Until another export starts. */
  written: DataFolderExportWritten | null;
  onClose: () => void;
  /** True when the export started and took the folder. */
  onStart: (destDir: string) => boolean;
  onStop: () => void;
}

/**
 * Settings → Export data folder: one zip of the whole `.upriv`, written
 * straight into a folder the user picks. A picked folder the export does not
 * take is let go when another is picked, when the window closes, and when the
 * vault list goes away.
 */
export function DataFolderExportModal({
  open,
  canStart,
  job,
  written,
  onClose,
  onStart,
  onStop,
}: DataFolderExportModalProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const vaultRoot = useVaultRootService();
  const dataFolder = useDataFolderService();
  const [destDir, setDestDir] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickFailed, setPickFailed] = useState(false);
  const budget = useLoadingBudget(job !== null, LOADING_BUDGET_MS.dataFolderExport, {
    startedAt: job?.startedAt,
  });
  const unusedPick = useRef<string | null>(null);
  unusedPick.current = destDir;

  // The vault list went away with a folder picked and not exported.
  useEffect(() => {
    const pick = unusedPick;
    return () => {
      if (pick.current) dataFolder?.releaseDestination?.(pick.current);
    };
  }, [dataFolder]);

  if (!open) return null;

  const releasePick = (uri: string | null) => {
    if (uri) dataFolder?.releaseDestination?.(uri);
  };

  const chooseFolder = async () => {
    setPicking(true);
    setPickFailed(false);
    try {
      const picked = (
        await vaultRoot.pickFolder(destDir, t("modal.data_folder_export.picker_title"))
      )?.trim();
      if (!picked) return;
      if (picked !== destDir) releasePick(destDir);
      setDestDir(picked);
    } catch {
      setPickFailed(true);
    } finally {
      setPicking(false);
    }
  };

  const close = () => {
    releasePick(destDir);
    setDestDir(null);
    onClose();
  };

  const start = () => {
    if (destDir && onStart(destDir)) setDestDir(null);
  };

  const progress = job?.progress ?? null;
  const percent = dataFolderExportPercent(progress);

  return (
    <Modal
      open={open}
      title={t("modal.data_folder_export.title")}
      titleIcon="archive"
      onClose={close}
      dismissible
      panelClassName="max-w-lg"
      footer={
        <ModalFooterActions layout="dialog">
          <Button
            label={job || written ? t("action.close") : t("action.cancel")}
            variant="ghost"
            onPress={close}
          />
          {job ? (
            <Button
              label={
                job.stopping
                  ? t("modal.data_folder_export.stopping")
                  : t("modal.data_folder_export.stop")
              }
              variant="secondary"
              disabled={job.stopping}
              busy={job.stopping}
              onPress={onStop}
            />
          ) : (
            <Button
              label={t("modal.data_folder_export.confirm")}
              variant="primary"
              disabled={!canStart || !destDir || picking}
              onPress={start}
            />
          )}
        </ModalFooterActions>
      }
    >
      <View style={styles.body}>
        <Text style={[typography.bodyMuted, { color: colors.onSurfaceVariant }]}>
          {t("modal.data_folder_export.body")}
        </Text>
        <Text style={[typography.bodyMuted, { color: colors.onSurfaceVariant }]}>
          {t("modal.data_folder_export.hold_note")}
        </Text>
        {job ? (
          <View style={styles.section}>
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
            <Text style={[typography.body, { color: colors.onSurface }]}>
              {progress && progress.bytesTotal > 0
                ? t("modal.data_folder_export.progress", {
                    done: formatBytes(progress.bytesDone),
                    total: formatBytes(progress.bytesTotal),
                  })
                : t("modal.data_folder_export.measuring")}
            </Text>
            <Text style={[typography.caption, { color: colors.onSurfaceVariant }]}>
              {t("modal.data_folder_export.background_note")}
            </Text>
            {budget.visible ? (
              <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
            ) : null}
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <FieldLabel>{t("modal.data_folder_export.folder_label")}</FieldLabel>
              <FieldHint>{t("modal.data_folder_export.file_hint")}</FieldHint>
              <PathField
                value={destDir ?? ""}
                editable={false}
                placeholder={t("modal.data_folder_export.folder_none")}
              />
              <Button
                label={t("modal.data_folder_export.choose_folder")}
                variant="secondary"
                disabled={picking}
                busy={picking}
                onPress={() => void chooseFolder()}
              />
            </View>
            {pickFailed ? (
              <Text
                accessibilityRole="alert"
                style={[typography.caption, { color: colors.onErrorContainer }]}
              >
                {t("error.unexpected")}
              </Text>
            ) : null}
            {canStart ? null : (
              <Text style={[typography.caption, { color: colors.onErrorContainer }]}>
                {t("modal.data_folder_export.blocked")}
              </Text>
            )}
            {written ? (
              <View style={styles.section}>
                <Text style={[typography.body, { color: colors.vaultStatusOpen }]}>
                  {t("modal.data_folder_export.done", { name: written.name })}
                </Text>
                {/* The export let go of this folder's grant, so the Files app
                    could not be handed it: no open button. */}
                <PathField value={written.folder} openPath="" editable={false} />
              </View>
            ) : null}
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  section: { gap: spacing.sm },
  track: {
    height: spacing.sm,
    borderRadius: radii.full,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: radii.full },
  fillMeasuring: { width: "25%", opacity: 0.5 },
});
