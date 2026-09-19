import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import {
  formatBytes,
  formatLogFileDate,
  LOADING_BUDGET_MS,
  MODAL_CLOSE_MS,
  parseLogLine,
  shouldBumpVaultRootEpoch,
  type AppLogFile,
  type ParsedLogLine,
} from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { useLoadingBudget, useToast } from "@upriv/shared/react";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import { Button, IconButton, LoadingBudgetHint, Modal, Toast } from "@/components/ui";
import { useAppSettingsContext } from "@/features/system/settings/AppSettingsContext";
import { downloadLogsZip } from "./downloadLogsZip";
import { logLevelClass } from "./logFormat";
import { useAppLogs } from "./hooks/useAppLogs";

const logCheckboxClass =
  "h-4 w-4 shrink-0 rounded border-outline-variant/50 bg-surface-container-high text-accent focus:ring-accent/50";

interface LogsModalProps {
  open: boolean;
  onClose: () => void;
}

export function LogsModal({ open, onClose }: LogsModalProps) {
  const { locale, t } = useTranslation();
  const { message: toastMessage, show: showToast, dismiss: dismissToast } = useToast();
  const { reportVaultRootIntegrityFailure } = useAppSettingsContext();
  const {
    files,
    loading,
    loadFailed,
    loadError,
    deleteFiles,
    getFile,
    loadFileContent,
    reload,
    cancelLoading,
  } = useAppLogs(open);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  /** Viewer mounts only when `viewerText` is set — timeout stays on the list. */
  const [activeFilename, setActiveFilename] = useState<string | null>(null);
  /** Row open in flight; list stays visible until load resolves. */
  const [openingFilename, setOpeningFilename] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  /** Content for the open viewer — set from `loadFileContent` return (avoids empty flash). */
  const [viewerText, setViewerText] = useState<string | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null);
  const [listTimedOut, setListTimedOut] = useState(false);
  const [viewerTimedOut, setViewerTimedOut] = useState(false);
  const [viewerTimedOutFilename, setViewerTimedOutFilename] = useState<string | null>(null);
  const viewerGen = useRef(0);
  const openingFilenameRef = useRef<string | null>(null);
  const rootIntegrityHandled = useRef(false);

  openingFilenameRef.current = openingFilename;

  const listBudget = useLoadingBudget(open && loading && !listTimedOut, LOADING_BUDGET_MS.logs);

  useEffect(() => {
    if (!open) {
      rootIntegrityHandled.current = false;
      return;
    }
    if (!loadFailed || loadError == null) return;
    if (shouldBumpVaultRootEpoch(loadError)) {
      if (rootIntegrityHandled.current) return;
      rootIntegrityHandled.current = true;
      void reportVaultRootIntegrityFailure(loadError).then(() => {
        onClose();
      });
      return;
    }
    showToast(t(desktopErrorI18nKey(loadError, "toast.logs_load_failed")));
  }, [open, loadFailed, loadError, onClose, reportVaultRootIntegrityFailure, showToast, t]);

  const allFilenames = useMemo(() => files.map((entry) => entry.filename), [files]);
  const allSelected =
    allFilenames.length > 0 && allFilenames.every((filename) => selected.has(filename));
  const someSelected = selected.size > 0;
  const activeFileMeta = activeFilename ? getFile(activeFilename) : undefined;
  const activeFile =
    activeFilename && viewerText !== null && activeFileMeta
      ? { ...activeFileMeta, content: viewerText }
      : undefined;
  const viewerBudget = useLoadingBudget(
    open && Boolean(openingFilename) && !viewerTimedOut,
    LOADING_BUDGET_MS.logs,
  );

  useEffect(() => {
    if (!listBudget.timedOut) return;
    cancelLoading();
    setListTimedOut(true);
  }, [listBudget.timedOut, cancelLoading]);

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
    if (open) {
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
      return;
    }
    // Drop in-flight viewer loads immediately; clear UI state after the close tween.
    viewerGen.current += 1;
    const id = window.setTimeout(() => {
      setSelected(new Set());
      setActiveFilename(null);
      setOpeningFilename(null);
      setViewerText(null);
      setDeleteTargets(null);
      setViewerLoading(false);
      setListTimedOut(false);
      setViewerTimedOut(false);
      setViewerTimedOutFilename(null);
    }, MODAL_CLOSE_MS);
    return () => window.clearTimeout(id);
  }, [open]);

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
    // Only drop confirm when targets vanished — not on every list refresh.
    setDeleteTargets((current) => {
      if (current === null) return null;
      const stillPresent = current.filter((name) => allFilenames.includes(name));
      return stillPresent.length === 0 ? null : stillPresent;
    });
  }, [activeFilename, openingFilename, allFilenames]);

  useEffect(() => {
    if (!openingFilename) return;
    const gen = ++viewerGen.current;
    let cancelled = false;
    setViewerLoading(true);
    setViewerTimedOut(false);
    void loadFileContent(openingFilename)
      .then((content) => {
        if (cancelled || gen !== viewerGen.current) return;
        if (content === null) {
          setOpeningFilename(null);
          return;
        }
        setViewerText(content);
        setActiveFilename(openingFilename);
        setOpeningFilename(null);
      })
      .catch((error) => {
        if (!cancelled && gen === viewerGen.current) {
          setOpeningFilename(null);
          setViewerText(null);
          showToast(t(desktopErrorI18nKey(error, "toast.logs_load_failed")));
        }
      })
      .finally(() => {
        if (!cancelled && gen === viewerGen.current) setViewerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openingFilename, loadFileContent, showToast, t]);

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
      await deleteFiles(deleteTargets);
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
          if (content == null || content.length === 0) {
            throw new Error(`empty log content for ${entry.filename}`);
          }
          return { filename: entry.filename, content };
        }),
      );
      downloadLogsZip(withContent, t("modal.logs.download_zip_name"));
    } catch (error) {
      showToast(t(desktopErrorI18nKey(error, "toast.logs_load_failed")));
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
      <div className="flex flex-col gap-3">
        <div className="text-sm" aria-live="polite">
          <p className="text-on-surface-variant">
            {deleteTargets.length === 1
              ? t("modal.logs.delete_confirm_one")
              : t("modal.logs.delete_confirm_many", { count: String(deleteTargets.length) })}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row-reverse sm:flex-wrap sm:justify-start [&_button]:w-full sm:[&_button]:w-auto">
          <Button
            variant="danger"
            size="md"
            onClick={() => {
              void handleConfirmDelete();
            }}
          >
            {t("action.delete")}
          </Button>
          <Button variant="ghost" size="md" onClick={() => setDeleteTargets(null)}>
            {t("action.cancel")}
          </Button>
        </div>
      </div>
    ) : activeFile ? (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" size="md" onClick={backToList} className="w-full sm:w-auto">
          {t("modal.logs.back_to_list")}
        </Button>
      </div>
    ) : undefined;

  return (
    <>
      <Modal
        open={open}
        title={t("modal.logs.title")}
        titleIcon="terminal"
        contextTitle={activeFile?.filename}
        onClose={onClose}
        panelClassName="max-w-5xl"
        footer={footer}
      >
        {activeFile ? (
          <div className="min-w-0">
            <LogFileViewer file={activeFile} />
          </div>
        ) : (
          <div
            onPointerDown={() => {
              if (deleteTargets !== null) setDeleteTargets(null);
            }}
          >
            <p className="mb-4 text-sm text-on-surface-variant">{t("modal.logs.hint")}</p>

            {listTimedOut ? (
              <div className="py-10 text-center text-sm text-on-surface-variant">
                <p role="alert">{t("loading.timed_out")}</p>
                <div className="mt-4 flex justify-center">
                  <Button variant="primary" size="md" onClick={retryList}>
                    {t("action.retry")}
                  </Button>
                </div>
              </div>
            ) : loading && listBudget.visible ? (
              <div className="py-10 text-center font-mono text-sm text-on-surface-variant">
                <p>{t("modal.logs.loading")}</p>
                <LoadingBudgetHint
                  budgetMs={listBudget.budgetMs}
                  remainingMs={listBudget.remainingMs}
                />
              </div>
            ) : !loading &&
              loadFailed &&
              files.length === 0 &&
              !shouldBumpVaultRootEpoch(loadError) ? (
              <div className="py-10 text-center text-sm text-on-surface-variant">
                <p role="alert">{t("toast.logs_load_failed")}</p>
                <div className="mt-4 flex justify-center">
                  <Button variant="primary" size="md" onClick={retryList}>
                    {t("action.retry")}
                  </Button>
                </div>
              </div>
            ) : !loading && files.length === 0 ? (
              <p className="py-10 text-center font-mono text-sm text-on-surface-variant">
                {t("modal.logs.empty")}
              </p>
            ) : loading && files.length === 0 ? (
              <div className="py-10" aria-busy="true" />
            ) : (
              <>
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

                <ul className="space-y-2" aria-busy={viewerLoading || Boolean(openingFilename)}>
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
                </ul>
              </>
            )}
          </div>
        )}
      </Modal>
      <Toast message={toastMessage} onDismiss={dismissToast} className="z-[220]" />
    </>
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
  const selectAllId = useId();

  return (
    <div className="mb-2 flex min-h-14 flex-wrap items-center gap-2 pl-4 pr-2 sm:flex-nowrap sm:pl-4 sm:pr-3">
      <label
        htmlFor={selectAllId}
        className="flex min-w-0 flex-1 cursor-pointer select-none items-center gap-3"
      >
        <input
          id={selectAllId}
          type="checkbox"
          checked={allSelected}
          ref={(node) => {
            if (node) node.indeterminate = someSelected && !allSelected;
          }}
          onChange={onToggleSelectAll}
          className={logCheckboxClass}
        />
        <span className="text-sm text-on-surface-variant">{t("modal.logs.select_all")}</span>
      </label>

      <div className="flex shrink-0 items-center gap-1 sm:ml-auto">
        {someSelected ? (
          <span className="pr-1 text-xs tabular-nums text-on-surface-variant">
            {t("modal.logs.selected_count", { count: String(selectedCount) })}
          </span>
        ) : null}
        <Button variant="secondary" size="sm" onClick={onDownload}>
          {someSelected ? t("modal.logs.download_selected") : t("modal.logs.download_all")}
        </Button>
        {someSelected ? (
          <IconButton
            label={t("modal.logs.delete_selected")}
            size="row"
            variant="row-action"
            className="-mr-1 text-on-surface-variant hover:bg-error-container/20 hover:text-on-error-container"
            onClick={onDeleteSelected}
          >
            <Icon name="trash" size={18} />
          </IconButton>
        ) : null}
      </div>
    </div>
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
  const checkboxId = useId();

  return (
    <li
      className={[
        "flex min-h-14 items-center gap-3 rounded-xl border border-transparent py-3 pl-4 pr-2 transition-colors sm:py-3.5 sm:pl-4 sm:pr-3",
        "bg-surface-container",
        checked || opening || timedOut ? "border-accent/40" : "hover:bg-surface-container-high/80",
        selectionDisabled && !opening ? "opacity-60" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <input
        id={checkboxId}
        type="checkbox"
        checked={checked}
        disabled={selectionDisabled}
        onChange={onToggleSelected}
        className={[logCheckboxClass, "disabled:opacity-40"].join(" ")}
      />
      <button
        type="button"
        disabled={selectionDisabled}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-xs text-on-surface sm:text-sm">
              {entry.filename}
            </span>
            {entry.isCurrent ? (
              <span className="rounded bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                {t("modal.logs.badge.active")}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block text-xs text-on-surface-variant">
            {formatLogFileDate(entry.createdAt, locale)}
            <span aria-hidden className="mx-1.5">
              ·
            </span>
            <span className="font-mono tabular-nums">
              {t("modal.logs.meta", {
                lines: entry.lineCountExact
                  ? String(entry.lineCount)
                  : t("modal.logs.meta_lines_unknown"),
                size: formatBytes(entry.sizeBytes),
              })}
            </span>
          </span>
          {openingBudget ? (
            <span className="mt-2 block">
              <LoadingBudgetHint
                budgetMs={openingBudget.budgetMs}
                remainingMs={openingBudget.remainingMs}
              />
            </span>
          ) : null}
          {timedOut ? (
            <span className="mt-1 block text-xs" role="alert">
              {t("loading.timed_out")}
            </span>
          ) : null}
        </span>
      </button>
      {timedOut ? (
        <Button variant="secondary" size="sm" onClick={onRetry} className="shrink-0">
          {t("action.retry")}
        </Button>
      ) : (
        <IconButton
          label={t("action.delete")}
          size="row"
          variant="row-action"
          disabled={selectionDisabled}
          className="-mr-1 shrink-0 text-on-surface-variant hover:bg-error-container/20 hover:text-on-error-container disabled:opacity-40"
          onClick={onDelete}
        >
          <Icon name="trash" size={18} />
        </IconButton>
      )}
    </li>
  );
}

/** Renders the full log file in the DOM — acceptable for a debug tool; redact before shipping real logs. */
function LogFileViewer({ file }: { file: AppLogFile }) {
  const lines = useMemo(() => file.content.trimEnd().split("\n").map(parseLogLine), [file.content]);
  const endRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const el = endRef.current;
    if (!el) return;
    const pane = el.closest(".modal-scroll-pane");
    if (pane instanceof HTMLElement) {
      pane.scrollTop = pane.scrollHeight;
      return;
    }
    el.scrollIntoView({ block: "end" });
  }, [file.filename, file.content]);

  return (
    <div className="max-w-full overflow-x-auto rounded-xl bg-[var(--log-viewer-bg)] p-4 ring-1 ring-outline-variant/25 sm:p-5">
      <ul className="min-w-0 max-w-full space-y-1.5 font-mono text-xs leading-6 sm:text-sm sm:leading-7">
        {lines.map((line, index) => (
          <li
            key={`${file.filename}-${index}`}
            ref={index === lines.length - 1 ? endRef : undefined}
            className="min-w-0 max-w-full"
          >
            <LogLineRow line={line} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function LogLineRow({ line }: { line: ParsedLogLine }) {
  if (line.level === "UNKNOWN") {
    return (
      <p className="max-w-full break-words whitespace-pre-wrap py-0.5 text-on-surface-variant">
        {line.raw}
      </p>
    );
  }

  return (
    <div className="min-w-0 max-w-full">
      <div className="flex min-w-0 max-w-full flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="shrink-0 tabular-nums text-on-surface-variant/80">{line.index}</span>
        <span className="shrink-0 tabular-nums text-on-surface-variant">{line.timestamp}</span>
        <span className={`shrink-0 font-semibold ${logLevelClass(line.level)}`}>{line.level}</span>
        <span className="min-w-0 break-words text-on-surface">{line.event}</span>
      </div>
      {line.fields ? (
        <p className="mt-0.5 min-w-0 max-w-full break-words pl-0 text-on-surface-variant/90 [overflow-wrap:anywhere] sm:pl-[4.5rem]">
          {line.fields}
        </p>
      ) : null}
    </div>
  );
}
