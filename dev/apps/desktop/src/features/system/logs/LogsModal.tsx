import { useEffect, useId, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Button, IconButton, Modal } from "@/components/ui";
import {
  formatBytes,
  formatLogFileDate,
  parseLogLine,
  type AppLogFile,
  type ParsedLogLine,
} from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { useToast } from "@/hooks/useToast";
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
  const { show: showToast } = useToast();
  const { files, deleteFiles, getFile } = useAppLogs(open);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [activeFilename, setActiveFilename] = useState<string | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null);

  const allFilenames = useMemo(() => files.map((entry) => entry.filename), [files]);
  const selectableFilenames = useMemo(
    () => files.filter((entry) => !entry.isCurrent).map((entry) => entry.filename),
    [files],
  );
  const allSelected =
    selectableFilenames.length > 0 &&
    selectableFilenames.every((filename) => selected.has(filename));
  const someSelected = selected.size > 0;
  const activeFile = activeFilename ? getFile(activeFilename) : undefined;

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setActiveFilename(null);
      setDeleteTargets(null);
    }
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
    }
    setDeleteTargets(null);
  }, [activeFilename, allFilenames]);

  if (!open) return null;

  const handleClose = () => {
    setSelected(new Set());
    setActiveFilename(null);
    setDeleteTargets(null);
    onClose();
  };

  const toggleSelected = (filename: string) => {
    const entry = files.find((item) => item.filename === filename);
    if (entry?.isCurrent) return;
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
    setSelected(new Set(selectableFilenames));
  };

  const beginDelete = (filenames: string[]) => {
    const targets = filenames.filter(
      (filename) => !files.find((entry) => entry.filename === filename)?.isCurrent,
    );
    if (targets.length === 0) return;
    setDeleteTargets(targets);
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
      }
      setDeleteTargets(null);
    } catch {
      showToast(t("toast.logs_delete_failed"));
    }
  };

  const handleDownload = () => {
    const targets = someSelected ? files.filter((entry) => selected.has(entry.filename)) : files;
    if (targets.length === 0) return;

    downloadLogsZip(
      targets.map((entry) => ({ filename: entry.filename, content: entry.content })),
      t("modal.logs.download_zip_name"),
    );
  };

  const title = activeFile ? activeFile.filename : t("modal.logs.title");

  return (
    <Modal
      open={open}
      title={title}
      onClose={handleClose}
      panelClassName={activeFile ? "max-w-5xl" : "max-w-3xl"}
      headerActions={
        activeFile ? (
          <IconButton
            label={t("modal.logs.back_to_list")}
            size="sm"
            onClick={() => setActiveFilename(null)}
          >
            <Icon name="chevron-down" size={18} className="rotate-90" />
          </IconButton>
        ) : null
      }
    >
      {activeFile ? (
        <div className="min-w-0">
          <LogFileViewer file={activeFile} />
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-on-surface-variant">{t("modal.logs.hint")}</p>

          {files.length === 0 ? (
            <p className="py-10 text-center font-mono text-sm text-on-surface-variant">
              {t("modal.logs.empty")}
            </p>
          ) : (
            <>
              {deleteTargets === null ? (
                <LogListToolbar
                  allSelected={allSelected}
                  someSelected={someSelected}
                  selectedCount={selected.size}
                  onToggleSelectAll={toggleSelectAll}
                  onDeleteSelected={() => beginDelete(Array.from(selected))}
                  onDownload={handleDownload}
                />
              ) : null}

              <ul className="modal-scroll-pane max-h-[50vh] space-y-2">
                {files.map((entry) => (
                  <LogFileRow
                    key={entry.filename}
                    entry={entry}
                    locale={locale}
                    checked={selected.has(entry.filename)}
                    selectionDisabled={deleteTargets !== null}
                    onToggleSelected={() => toggleSelected(entry.filename)}
                    onOpen={() => setActiveFilename(entry.filename)}
                    onDelete={() => beginDelete([entry.filename])}
                  />
                ))}
              </ul>
            </>
          )}

          {deleteTargets !== null ? (
            <div className="mt-4 rounded-xl border border-outline-variant/20 bg-surface-container px-4 py-4">
              <p className="mb-3 text-sm text-on-surface-variant">
                {deleteTargets.length === 1
                  ? t("modal.logs.delete_confirm_one")
                  : t("modal.logs.delete_confirm_many", { count: String(deleteTargets.length) })}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => setDeleteTargets(null)}
                >
                  {t("action.cancel")}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    void handleConfirmDelete();
                  }}
                >
                  {t("action.delete")}
                </Button>
              </div>
            </div>
          ) : null}
        </>
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
  onToggleSelected: () => void;
  onOpen: () => void;
  onDelete: () => void;
}

function LogFileRow({
  entry,
  locale,
  checked,
  selectionDisabled,
  onToggleSelected,
  onOpen,
  onDelete,
}: LogFileRowProps) {
  const { t } = useTranslation();
  const checkboxId = useId();

  return (
    <li
      className={[
        "flex min-h-14 items-center gap-3 rounded-xl border border-transparent py-3 pl-4 pr-2 transition-colors sm:py-3.5 sm:pl-4 sm:pr-3",
        "bg-surface-container",
        checked ? "border-accent/40" : "hover:bg-surface-container-high/80",
        selectionDisabled ? "opacity-60" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <input
        id={checkboxId}
        type="checkbox"
        checked={checked}
        disabled={selectionDisabled || entry.isCurrent}
        onChange={onToggleSelected}
        className={[logCheckboxClass, "disabled:opacity-40"].join(" ")}
      />
      <button
        type="button"
        disabled={selectionDisabled}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-container-highest text-on-surface-variant">
          <Icon name="terminal" size={18} />
        </div>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-xs text-on-surface sm:text-sm">
              {entry.filename}
            </span>
            {entry.isCurrent ? (
              <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
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
                lines: String(entry.lineCount),
                size: formatBytes(entry.sizeBytes),
              })}
            </span>
          </span>
        </span>
      </button>
      <IconButton
        label={t("action.delete")}
        size="row"
        variant="row-action"
        disabled={selectionDisabled || entry.isCurrent}
        className="-mr-1 shrink-0 text-on-surface-variant hover:bg-error-container/20 hover:text-on-error-container disabled:opacity-40"
        onClick={onDelete}
      >
        <Icon name="trash" size={18} />
      </IconButton>
    </li>
  );
}

/** Renders the full log file in the DOM — acceptable for a debug tool; redact before shipping real logs. */
function LogFileViewer({ file }: { file: AppLogFile }) {
  const lines = useMemo(() => file.content.trimEnd().split("\n").map(parseLogLine), [file.content]);

  return (
    <div className="max-h-[min(70vh,40rem)] overflow-auto rounded-xl bg-[var(--log-viewer-bg)] p-4 ring-1 ring-outline-variant/25 sm:p-5">
      <div
        className="grid w-max min-w-full gap-x-5 gap-y-0.5 font-mono text-xs leading-6 sm:text-sm sm:leading-7"
        style={{ gridTemplateColumns: "auto auto auto auto max-content" }}
      >
        {lines.map((line, index) => (
          <LogLineCells key={`${file.filename}-${index}`} line={line} />
        ))}
      </div>
    </div>
  );
}

function LogLineCells({ line }: { line: ParsedLogLine }) {
  if (line.level === "UNKNOWN") {
    return (
      <div className="col-span-5 whitespace-pre-wrap py-0.5 text-on-surface-variant">
        {line.raw}
      </div>
    );
  }

  return (
    <>
      <span className="whitespace-nowrap text-right tabular-nums text-on-surface-variant/80">
        {line.index}
      </span>
      <span className="whitespace-nowrap tabular-nums text-on-surface-variant">
        {line.timestamp}
      </span>
      <span className={`whitespace-nowrap font-semibold ${logLevelClass(line.level)}`}>
        {line.level}
      </span>
      <span className="whitespace-nowrap text-on-surface">{line.event}</span>
      <span className="whitespace-nowrap text-on-surface-variant/90">{line.fields}</span>
    </>
  );
}
