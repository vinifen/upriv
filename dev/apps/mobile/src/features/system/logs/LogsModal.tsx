import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  isRpcError,
  isVaultRootErrorCode,
  LOADING_BUDGET_MS,
  sortLogFilesNewestFirst,
  type AppLogFile,
} from "@upriv/shared";
import { useLogService } from "@/platform/services";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { radii, spacing } from "@/theme/tokens";
import { Button, LoadingBudgetHint, Modal } from "@/components/ui";
import { useLoadingBudget } from "@/hooks/useLoadingBudget";

interface LogsModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Log list + viewer. `log_list` returns metadata only — content comes from `log_get`
 * (same contract as desktop `useAppLogs.loadFileContent`).
 */
export function LogsModal({ open, onClose }: LogsModalProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const logService = useLogService();
  const { reportVaultRootIntegrityFailure } = useAppSettingsContext();
  const [files, setFiles] = useState<AppLogFile[]>([]);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [contentFailed, setContentFailed] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [listTimedOut, setListTimedOut] = useState(false);
  const [viewerTimedOut, setViewerTimedOut] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const listGen = useRef(0);
  const viewerGen = useRef(0);
  const rootIntegrityHandled = useRef(false);

  const listBudget = useLoadingBudget(open && listLoading && !listTimedOut, LOADING_BUDGET_MS.logs);
  const viewerBudget = useLoadingBudget(
    open && contentLoading && !viewerTimedOut,
    LOADING_BUDGET_MS.logs,
  );

  const reload = useCallback(async () => {
    const gen = ++listGen.current;
    setListFailed(false);
    setListTimedOut(false);
    setListLoading(true);
    setActiveName(null);
    setContent(null);
    setLoadError(null);
    try {
      const list = await logService.listFiles();
      if (gen !== listGen.current) return;
      setFiles(sortLogFilesNewestFirst(list));
    } catch (err) {
      if (gen !== listGen.current) return;
      setListFailed(true);
      setLoadError(err);
    } finally {
      if (gen === listGen.current) setListLoading(false);
    }
  }, [logService]);

  const openFile = useCallback(
    async (filename: string) => {
      const gen = ++viewerGen.current;
      setActiveName(filename);
      setContent(null);
      setContentFailed(false);
      setViewerTimedOut(false);
      setContentLoading(true);
      try {
        const file = await logService.getFile(filename);
        if (gen !== viewerGen.current) return;
        setContent(file?.content ?? "");
      } catch {
        if (gen !== viewerGen.current) return;
        setContentFailed(true);
      } finally {
        if (gen === viewerGen.current) setContentLoading(false);
      }
    },
    [logService],
  );

  useEffect(() => {
    if (!listBudget.timedOut) return;
    listGen.current += 1;
    setListLoading(false);
    setListTimedOut(true);
  }, [listBudget.timedOut]);

  useEffect(() => {
    if (!viewerBudget.timedOut) return;
    viewerGen.current += 1;
    setContentLoading(false);
    setViewerTimedOut(true);
  }, [viewerBudget.timedOut]);

  useEffect(() => {
    if (!open) {
      setActiveName(null);
      setContent(null);
      setContentFailed(false);
      setListTimedOut(false);
      setViewerTimedOut(false);
      rootIntegrityHandled.current = false;
      return;
    }
    void reload();
  }, [open, reload]);

  // Never surface an empty logs list for A/B integrity failures (`vault_root_*`).
  // Bump epoch + reload settings then close so the Gate can re-surface repair/setup.
  useEffect(() => {
    if (!open || !listFailed || loadError == null) return;
    if (isRpcError(loadError) && isVaultRootErrorCode(loadError.code)) {
      if (rootIntegrityHandled.current) return;
      rootIntegrityHandled.current = true;
      void reportVaultRootIntegrityFailure(loadError).finally(() => {
        onClose();
      });
    }
  }, [listFailed, loadError, onClose, open, reportVaultRootIntegrityFailure]);

  const listBusy = listLoading && listBudget.visible;
  const viewerBusy = contentLoading && viewerBudget.visible;

  return (
    <Modal
      open={open}
      title={t("modal.logs.title")}
      onClose={onClose}
      panelClassName={activeName ? "max-w-5xl" : "max-w-3xl"}
      bodyScroll={!activeName}
    >
      {listFailed ? (
        <View style={styles.center}>
          <Text style={[typography.body, { color: colors.onErrorContainer }]}>
            {t("toast.logs_load_failed")}
          </Text>
          <Button label={t("action.retry")} variant="accent" onPress={() => void reload()} />
        </View>
      ) : activeName ? (
        <View style={styles.viewer}>
          <Button
            label={t("action.back")}
            variant="ghost"
            onPress={() => {
              setActiveName(null);
              setContent(null);
              setContentFailed(false);
              setViewerTimedOut(false);
            }}
          />
          <Text style={typography.caption}>{activeName}</Text>
          {viewerTimedOut ? (
            <View style={styles.center}>
              <Text style={[typography.body, { color: colors.onErrorContainer }]} accessibilityRole="alert">
                {t("loading.timed_out")}
              </Text>
              <Button
                label={t("action.retry")}
                variant="accent"
                onPress={() => void openFile(activeName)}
              />
            </View>
          ) : viewerBusy ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} style={styles.spinner} />
              <Text style={typography.caption}>{t("modal.logs.loading")}</Text>
              <LoadingBudgetHint
                budgetMs={viewerBudget.budgetMs}
                remainingMs={viewerBudget.remainingMs}
              />
            </View>
          ) : contentLoading ? (
            <View style={styles.placeholder} accessibilityState={{ busy: true }} />
          ) : contentFailed ? (
            <View style={styles.center}>
              <Text style={[typography.body, { color: colors.onErrorContainer }]}>
                {t("toast.logs_load_failed")}
              </Text>
              <Button
                label={t("action.retry")}
                variant="accent"
                onPress={() => void openFile(activeName)}
              />
            </View>
          ) : (
            <ScrollView style={styles.contentScroll} nestedScrollEnabled>
              <Text
                style={[
                  typography.mono,
                  styles.mono,
                  {
                    backgroundColor: colors.logViewerBg,
                    color: colors.onSurface,
                  },
                ]}
                selectable
              >
                {content && content.length > 0 ? content : t("modal.logs.empty")}
              </Text>
            </ScrollView>
          )}
        </View>
      ) : listTimedOut ? (
        <View style={styles.center}>
          <Text style={[typography.body, { color: colors.onErrorContainer }]} accessibilityRole="alert">
            {t("loading.timed_out")}
          </Text>
          <Button label={t("action.retry")} variant="accent" onPress={() => void reload()} />
        </View>
      ) : listBusy ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} style={styles.spinner} />
          <Text style={typography.caption}>{t("modal.logs.loading")}</Text>
          <LoadingBudgetHint budgetMs={listBudget.budgetMs} remainingMs={listBudget.remainingMs} />
        </View>
      ) : listLoading ? (
        <View style={styles.placeholder} accessibilityState={{ busy: true }} />
      ) : (
        <View style={styles.list}>
          {files.length === 0 ? (
            <Text style={[typography.bodyMuted, styles.empty]}>{t("modal.logs.empty")}</Text>
          ) : (
            files.map((item) => (
              <Button
                key={item.filename}
                label={item.filename}
                variant="ghost"
                onPress={() => void openFile(item.filename)}
                style={styles.fileBtn}
              />
            ))
          )}
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  fileBtn: { alignItems: "flex-start" },
  empty: { textAlign: "center", padding: spacing.xl },
  center: { gap: spacing.md, alignItems: "center", padding: spacing.lg },
  viewer: { gap: spacing.md, flexGrow: 1, minHeight: 240 },
  contentScroll: { flexGrow: 1, maxHeight: 360 },
  mono: {
    padding: spacing.md,
    borderRadius: radii.sm,
  },
  spinner: { marginVertical: spacing.xl },
  placeholder: { minHeight: 80 },
});
