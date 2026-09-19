import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import {
  formatBytes,
  formatLogFileDate,
  LOADING_BUDGET_MS,
  MODAL_CLOSE_MS,
  parseLogLine,
  shouldBumpVaultRootEpoch,
  sortLogFilesNewestFirst,
  type AppLogFile,
  type ParsedLogLine,
} from "@upriv/shared";
import { useLogService } from "@/platform/services";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { useTheme } from "@/theme";
import { colorAlpha, radii, spacing } from "@/theme/tokens";
import {
  Button,
  Checkbox,
  IconButton,
  LoadingBudgetHint,
  Modal,
  ModalFooterActions,
  modalFooterConfirmBtnStyle,
  Toast,
} from "@/components/ui";
import { useLoadingBudget, useToast } from "@upriv/shared/react";
import { logLevelColor } from "./logFormat";
import { shareLogsZip } from "./shareLogsZip";

interface LogsModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Log list + viewer. `log_list` returns metadata only — content comes from `log_get`
 * (same contract as desktop `useAppLogs.loadFileContent`).
 */
export function LogsModal({ open, onClose }: LogsModalProps) {
  const { t, locale } = useTranslation();
  const { typography } = useTheme();
  const logService = useLogService();
  const { reportVaultRootIntegrityFailure } = useAppSettingsContext();
  const { message: toastMessage, show: showToast, dismiss: dismissToast } = useToast();

  const [files, setFiles] = useState<AppLogFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  /** Viewer mounts only when `viewerText` is set — timeout stays on the list. */
  const [activeFilename, setActiveFilename] = useState<string | null>(null);
  /** Row open in flight; list stays visible until load resolves. */
  const [openingFilename, setOpeningFilename] = useState<string | null>(null);
  const [viewerText, setViewerText] = useState<string | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [listTimedOut, setListTimedOut] = useState(false);
  const [viewerTimedOut, setViewerTimedOut] = useState(false);
  const [viewerTimedOutFilename, setViewerTimedOutFilename] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const listGen = useRef(0);
  const viewerGen = useRef(0);
  const openingFilenameRef = useRef<string | null>(null);
  const rootIntegrityHandled = useRef(false);

  openingFilenameRef.current = openingFilename;

  const listBudget = useLoadingBudget(open && listLoading && !listTimedOut, LOADING_BUDGET_MS.logs);
  const viewerBudget = useLoadingBudget(
    open && Boolean(openingFilename) && !viewerTimedOut,
    LOADING_BUDGET_MS.logs,
  );

  const allFilenames = useMemo(() => files.map((entry) => entry.filename), [files]);
  const allSelected =
    allFilenames.length > 0 && allFilenames.every((filename) => selected.has(filename));
  const someSelected = selected.size > 0;
  const activeFileMeta = activeFilename
    ? files.find((entry) => entry.filename === activeFilename)
    : undefined;
  const activeFile =
    activeFilename && viewerText !== null && activeFileMeta
      ? { ...activeFileMeta, content: viewerText }
      : undefined;

  const reload = useCallback(async () => {
    const gen = ++listGen.current;
    setListFailed(false);
    setListTimedOut(false);
    setListLoading(true);
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

  const loadFileContent = useCallback(
    async (filename: string): Promise<string> => {
      const existing = files.find((item) => item.filename === filename);
      if (existing?.content) return existing.content;
      const file = await logService.getFile(filename);
      if (!file) {
        throw new Error(`log file not found: ${filename}`);
      }
      return file.content;
    },
    [files, logService],
  );

  useEffect(() => {
    if (!listBudget.timedOut) return;
    listGen.current += 1;
    setListLoading(false);
    setListTimedOut(true);
  }, [listBudget.timedOut]);

  useEffect(() => {
    if (!viewerBudget.timedOut) return;
    const timedOutName = openingFilenameRef.current;
    viewerGen.current += 1;
    setViewerLoading(false);
    setViewerTimedOut(true);
    setOpeningFilename(null);
    setActiveFilename(null);
    setViewerText(null);
    if (timedOutName) {
      setViewerTimedOutFilename(timedOutName);
      showToast(t("loading.timed_out"));
    }
  }, [viewerBudget.timedOut, showToast, t]);

  useEffect(() => {
    if (!open) {
      // Drop in-flight loads immediately; clear UI state after the close tween.
      listGen.current += 1;
      viewerGen.current += 1;
      const id = setTimeout(() => {
        setSelected(new Set());
        setActiveFilename(null);
        setOpeningFilename(null);
        setViewerText(null);
        setDeleteTargets(null);
        setViewerLoading(false);
        setListLoading(false);
        setListTimedOut(false);
        setViewerTimedOut(false);
        setViewerTimedOutFilename(null);
        setListFailed(false);
        setLoadError(null);
        rootIntegrityHandled.current = false;
      }, MODAL_CLOSE_MS);
      return () => clearTimeout(id);
    }
    // Quick re-open cancels the delayed close reset — wipe stale viewer/selection here.
    setSelected(new Set());
    setActiveFilename(null);
    setOpeningFilename(null);
    setViewerText(null);
    setDeleteTargets(null);
    setViewerLoading(false);
    setListTimedOut(false);
    setViewerTimedOut(false);
    setViewerTimedOutFilename(null);
    setListFailed(false);
    setLoadError(null);
    rootIntegrityHandled.current = false;
    void reload();
  }, [open, reload]);

  useEffect(() => {
    if (!open || !listFailed || loadError == null) return;
    if (shouldBumpVaultRootEpoch(loadError)) {
      if (rootIntegrityHandled.current) return;
      rootIntegrityHandled.current = true;
      void reportVaultRootIntegrityFailure(loadError).then(() => {
        onClose();
      });
      return;
    }
    showToast(t(mobileErrorI18nKey(loadError, "toast.logs_load_failed")));
  }, [listFailed, loadError, onClose, open, reportVaultRootIntegrityFailure, showToast, t]);

  useEffect(() => {
    setSelected((current) => {
      const next = new Set<string>();
      for (const filename of current) {
        if (allFilenames.includes(filename)) next.add(filename);
      }
      return next;
    });
    if (activeFilename && !allFilenames.includes(activeFilename)) {
      setActiveFilename(null);
      setViewerText(null);
    }
    if (openingFilename && !allFilenames.includes(openingFilename)) {
      viewerGen.current += 1;
      setOpeningFilename(null);
      setViewerLoading(false);
    }
    setViewerTimedOutFilename((current) =>
      current && allFilenames.includes(current) ? current : null,
    );
    setDeleteTargets((current) => {
      if (current === null) return null;
      const stillPresent = current.filter((name) => allFilenames.includes(name));
      return stillPresent.length === 0 ? null : stillPresent;
    });
  }, [activeFilename, openingFilename, allFilenames]);

  useEffect(() => {
    if (!open || !openingFilename) return;
    const gen = ++viewerGen.current;
    let cancelled = false;
    setViewerLoading(true);
    setViewerTimedOut(false);
    void loadFileContent(openingFilename)
      .then((content) => {
        if (cancelled || gen !== viewerGen.current) return;
        setViewerText(content);
        setActiveFilename(openingFilename);
        setOpeningFilename(null);
      })
      .catch((error) => {
        if (!cancelled && gen === viewerGen.current) {
          setOpeningFilename(null);
          setViewerText(null);
          showToast(t(mobileErrorI18nKey(error, "toast.logs_load_failed")));
        }
      })
      .finally(() => {
        if (!cancelled && gen === viewerGen.current) setViewerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openingFilename, loadFileContent, open, showToast, t]);

  const openLogFile = (filename: string) => {
    if (deleteTargets !== null) return;
    setViewerTimedOut(false);
    setViewerTimedOutFilename(null);
    setViewerText(null);
    setActiveFilename(null);
    setOpeningFilename(filename);
  };

  const retryList = () => {
    setListTimedOut(false);
    void reload();
  };

  const retryViewer = (filename?: string | null) => {
    const name = filename ?? viewerTimedOutFilename;
    if (!name) return;
    setViewerTimedOut(false);
    setViewerTimedOutFilename(null);
    setViewerText(null);
    setActiveFilename(null);
    setOpeningFilename(name);
  };

  const toggleSelected = (filename: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(allFilenames));
  };

  const beginDelete = (filenames: string[]) => {
    if (filenames.length === 0) return;
    setDeleteTargets(filenames);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargets) return;
    try {
      await logService.deleteFiles(deleteTargets);
      setSelected((current) => {
        const next = new Set(current);
        for (const filename of deleteTargets) next.delete(filename);
        return next;
      });
      if (activeFilename && deleteTargets.includes(activeFilename)) {
        setActiveFilename(null);
        setViewerText(null);
      }
      if (openingFilename && deleteTargets.includes(openingFilename)) {
        viewerGen.current += 1;
        setOpeningFilename(null);
        setViewerLoading(false);
      }
      setDeleteTargets(null);
      await reload();
    } catch {
      showToast(t("toast.logs_delete_failed"));
    }
  };

  const handleDownload = async () => {
    const targets = someSelected ? files.filter((entry) => selected.has(entry.filename)) : files;
    if (targets.length === 0) return;
    try {
      const withContent = await Promise.all(
        targets.map(async (entry) => {
          const content = await loadFileContent(entry.filename);
          if (!content) {
            throw new Error(`empty log content for ${entry.filename}`);
          }
          return { filename: entry.filename, content };
        }),
      );
      await shareLogsZip(withContent, t("modal.logs.download_zip_name"));
    } catch (error) {
      showToast(t(mobileErrorI18nKey(error, "toast.logs_load_failed")));
    }
  };

  const showDeleteConfirm = deleteTargets !== null && !activeFilename;

  const backToList = () => {
    viewerGen.current += 1;
    setActiveFilename(null);
    setOpeningFilename(null);
    setViewerText(null);
    setViewerLoading(false);
    setViewerTimedOut(false);
    setViewerTimedOutFilename(null);
  };

  const footer =
    showDeleteConfirm && deleteTargets ? (
      <View style={styles.footerCol}>
        <Text style={[typography.bodyMuted, styles.confirmCopy]}>
          {deleteTargets.length === 1
            ? t("modal.logs.delete_confirm_one")
            : t("modal.logs.delete_confirm_many", { count: String(deleteTargets.length) })}
        </Text>
        <ModalFooterActions layout="confirm">
          <Button
            label={t("action.delete")}
            variant="danger"
            style={modalFooterConfirmBtnStyle}
            onPress={() => {
              void handleConfirmDelete();
            }}
          />
          <Button
            label={t("action.cancel")}
            variant="ghost"
            style={modalFooterConfirmBtnStyle}
            onPress={() => setDeleteTargets(null)}
          />
        </ModalFooterActions>
      </View>
    ) : activeFile ? (
      <ModalFooterActions layout="confirm">
        <Button
          label={t("modal.logs.back_to_list")}
          variant="ghost"
          style={modalFooterConfirmBtnStyle}
          onPress={backToList}
        />
      </ModalFooterActions>
    ) : undefined;

  const integrityHideEmpty = shouldBumpVaultRootEpoch(loadError);

  return (
    <Modal
      open={open}
      title={t("modal.logs.title")}
      titleIcon="terminal"
      contextTitle={activeFile?.filename}
      onClose={onClose}
      panelClassName="max-w-5xl"
      bodyScroll={!activeFile}
      footer={footer}
      overlay={<Toast message={toastMessage} onDismiss={dismissToast} />}
    >
      {activeFile ? (
        <LogFileViewer file={activeFile} />
      ) : (
        <View
          onTouchStart={() => {
            if (deleteTargets !== null) setDeleteTargets(null);
          }}
        >
          <Text style={[typography.bodyMuted, styles.hint]}>{t("modal.logs.hint")}</Text>

          {listTimedOut ? (
            <View style={styles.center}>
              <Text style={typography.bodyMuted} accessibilityRole="alert">
                {t("loading.timed_out")}
              </Text>
              <Button label={t("action.retry")} variant="primary" onPress={retryList} />
            </View>
          ) : listLoading && listBudget.visible ? (
            <View style={styles.center}>
              <Text style={typography.mono}>{t("modal.logs.loading")}</Text>
              <LoadingBudgetHint
                budgetMs={listBudget.budgetMs}
                remainingMs={listBudget.remainingMs}
              />
            </View>
          ) : !listLoading && listFailed && files.length === 0 && !integrityHideEmpty ? (
            <View style={styles.center}>
              <Text style={typography.bodyMuted} accessibilityRole="alert">
                {t("toast.logs_load_failed")}
              </Text>
              <Button label={t("action.retry")} variant="primary" onPress={retryList} />
            </View>
          ) : !listLoading && files.length === 0 ? (
            <Text style={[typography.mono, styles.empty]}>{t("modal.logs.empty")}</Text>
          ) : listLoading && files.length === 0 ? (
            <View style={styles.placeholder} accessibilityState={{ busy: true }} />
          ) : (
            <View
              style={styles.list}
              accessibilityState={{ busy: viewerLoading || Boolean(openingFilename) }}
            >
              {deleteTargets === null ? (
                <LogListToolbar
                  allSelected={allSelected}
                  someSelected={someSelected}
                  selectedCount={selected.size}
                  onToggleSelectAll={toggleSelectAll}
                  onDeleteSelected={() => beginDelete(Array.from(selected))}
                  onDownload={() => {
                    void handleDownload();
                  }}
                />
              ) : null}

              {files.map((entry) => (
                <LogFileRow
                  key={entry.filename}
                  entry={entry}
                  locale={locale}
                  checked={selected.has(entry.filename)}
                  selectionDisabled={deleteTargets !== null || Boolean(openingFilename)}
                  opening={openingFilename === entry.filename}
                  timedOut={viewerTimedOutFilename === entry.filename}
                  openingBudget={
                    openingFilename === entry.filename && viewerBudget.visible
                      ? {
                          budgetMs: viewerBudget.budgetMs,
                          remainingMs: viewerBudget.remainingMs,
                        }
                      : null
                  }
                  onToggleSelected={() => toggleSelected(entry.filename)}
                  onOpen={() => openLogFile(entry.filename)}
                  onRetry={() => retryViewer(entry.filename)}
                  onDelete={() => beginDelete([entry.filename])}
                />
              ))}
            </View>
          )}
        </View>
      )}
    </Modal>
  );
}

interface LogListToolbarProps {
  allSelected: boolean;
  someSelected: boolean;
  selectedCount: number;
  onToggleSelectAll: () => void;
  onDeleteSelected: () => void;
  onDownload: () => void;
}

function LogListToolbar({
  allSelected,
  someSelected,
  selectedCount,
  onToggleSelectAll,
  onDeleteSelected,
  onDownload,
}: LogListToolbarProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();

  return (
    <View style={styles.toolbar}>
      <Pressable style={styles.toolbarSelect} onPress={onToggleSelectAll}>
        <Checkbox
          checked={allSelected}
          indeterminate={someSelected && !allSelected}
          onChange={onToggleSelectAll}
          label={t("modal.logs.select_all")}
        />
        <Text style={typography.bodyMuted}>{t("modal.logs.select_all")}</Text>
      </Pressable>
      <View style={styles.toolbarActions}>
        {someSelected ? (
          <Text style={[typography.caption, styles.selectedCount]}>
            {t("modal.logs.selected_count", { count: String(selectedCount) })}
          </Text>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          label={someSelected ? t("modal.logs.download_selected") : t("modal.logs.download_all")}
          onPress={onDownload}
        />
        {someSelected ? (
          <IconButton
            label={t("modal.logs.delete_selected")}
            icon="trash"
            size={18}
            tone="muted"
            onPress={onDeleteSelected}
          />
        ) : null}
      </View>
    </View>
  );
}

interface LogFileRowProps {
  entry: AppLogFile;
  locale: string;
  checked: boolean;
  selectionDisabled: boolean;
  opening?: boolean;
  timedOut?: boolean;
  openingBudget?: { budgetMs: number; remainingMs: number } | null;
  onToggleSelected: () => void;
  onOpen: () => void;
  onRetry: () => void;
  onDelete: () => void;
}

function LogFileRow({
  entry,
  locale,
  checked,
  selectionDisabled,
  opening = false,
  timedOut = false,
  openingBudget = null,
  onToggleSelected,
  onOpen,
  onRetry,
  onDelete,
}: LogFileRowProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.surfaceContainer,
          borderColor:
            checked || opening || timedOut ? colorAlpha(colors.accent, 0.4) : "transparent",
          opacity: selectionDisabled && !opening ? 0.6 : 1,
        },
      ]}
    >
      <Checkbox
        checked={checked}
        disabled={selectionDisabled}
        onChange={onToggleSelected}
        label={entry.filename}
      />
      <Pressable
        disabled={selectionDisabled}
        onPress={onOpen}
        style={styles.rowMain}
        accessibilityRole="button"
        accessibilityLabel={entry.filename}
      >
        <View style={styles.rowCopy}>
          <View style={styles.rowTitleRow}>
            <Text
              style={[typography.mono, styles.rowTitle, { color: colors.onSurface }]}
              numberOfLines={1}
            >
              {entry.filename}
            </Text>
            {entry.isCurrent ? (
              <View style={[styles.badge, { backgroundColor: colorAlpha(colors.accent, 0.15) }]}>
                <Text style={[styles.badgeText, { color: colors.accent }]}>
                  {t("modal.logs.badge.active")}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={typography.caption}>
            {formatLogFileDate(entry.createdAt, locale)}
            <Text> · </Text>
            <Text style={typography.mono}>
              {t("modal.logs.meta", {
                lines: entry.lineCountExact
                  ? String(entry.lineCount)
                  : t("modal.logs.meta_lines_unknown"),
                size: formatBytes(entry.sizeBytes),
              })}
            </Text>
          </Text>
          {openingBudget ? (
            <LoadingBudgetHint
              budgetMs={openingBudget.budgetMs}
              remainingMs={openingBudget.remainingMs}
            />
          ) : null}
          {timedOut ? (
            <Text style={typography.caption} accessibilityRole="alert">
              {t("loading.timed_out")}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {timedOut ? (
        <Button label={t("action.retry")} variant="secondary" size="sm" onPress={onRetry} />
      ) : (
        <IconButton
          label={t("action.delete")}
          icon="trash"
          size={18}
          tone="muted"
          disabled={selectionDisabled}
          onPress={onDelete}
        />
      )}
    </View>
  );
}

function LogFileViewer({ file }: { file: AppLogFile }) {
  const { colors, typography } = useTheme();
  const listRef = useRef<FlatList<ParsedLogLine>>(null);
  const lines = useMemo(() => file.content.trimEnd().split("\n").map(parseLogLine), [file.content]);

  return (
    <FlatList
      ref={listRef}
      style={styles.viewerScroll}
      data={lines}
      keyExtractor={(_, index) => `${file.filename}:${index}`}
      renderItem={({ item }) => <LogLineRow line={item} mono={typography.mono} />}
      initialNumToRender={80}
      contentContainerStyle={[
        styles.viewer,
        {
          backgroundColor: colors.logViewerBg,
          borderColor: colorAlpha(colors.outlineVariant, 0.25),
        },
      ]}
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="none"
      onContentSizeChange={() => {
        listRef.current?.scrollToEnd({ animated: false });
      }}
    />
  );
}

function LogLineRow({
  line,
  mono,
}: {
  line: ParsedLogLine;
  mono: { fontSize: number; fontFamily: string; color: string };
}) {
  const { colors } = useTheme();
  if (line.level === "UNKNOWN") {
    return (
      <Text style={[mono, styles.unknownLine, { color: colors.onSurfaceVariant }]} selectable>
        {line.raw}
      </Text>
    );
  }

  return (
    <View style={styles.logLine}>
      <View style={styles.logLineMeta}>
        <Text style={[mono, styles.logIndex, { color: colorAlpha(colors.onSurfaceVariant, 0.8) }]}>
          {line.index}
        </Text>
        <Text style={[mono, { color: colors.onSurfaceVariant }]}>{line.timestamp}</Text>
        <Text style={[mono, styles.logLevel, { color: logLevelColor(line.level, colors) }]}>
          {line.level}
        </Text>
        <Text style={[mono, styles.logEvent, { color: colors.onSurface }]}>{line.event}</Text>
      </View>
      {line.fields ? (
        <Text
          style={[mono, styles.logFields, { color: colorAlpha(colors.onSurfaceVariant, 0.9) }]}
          selectable
        >
          {line.fields}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: spacing.md },
  list: { gap: spacing.sm },
  empty: { textAlign: "center", paddingVertical: 40 },
  center: { gap: spacing.md, alignItems: "center", paddingVertical: 40 },
  placeholder: { minHeight: 80 },
  toolbar: {
    minHeight: 56,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
  },
  toolbarSelect: {
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minWidth: 0,
  },
  toolbarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  selectedCount: { paddingRight: spacing.xs },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  rowTitleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  rowTitle: { flexShrink: 1 },
  badge: {
    borderRadius: radii.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  footerCol: { gap: spacing.md },
  confirmCopy: { fontSize: 14 },
  viewerScroll: { flexGrow: 1, maxHeight: 420 },
  viewer: {
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.lg,
    gap: 6,
  },
  logLine: { gap: 2 },
  logLineMeta: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: spacing.sm },
  logIndex: { fontVariant: ["tabular-nums"] },
  logLevel: { fontWeight: "600" },
  logEvent: { flexShrink: 1 },
  logFields: { paddingLeft: 0 },
  unknownLine: { paddingVertical: 2 },
});
