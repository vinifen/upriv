import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { useBackupService } from "@/platform/services";
import { Icon } from "@/components/icons";
import { Button, IconButton, LoadingBudgetHint, Modal, Toast } from "@/components/ui";
import {
  backupDeleteConfirmPhrase,
  backupEntryFileName,
  backupEntryKey,
  backupExportFilename,
  backupExportRowKey,
  formatBytes,
  formatBackupDate,
  LOADING_BUDGET_MS,
  matchesBackupDeleteConfirmation,
  type VaultBackupEntry,
  type VaultListItem,
} from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { useErrorToast } from "@/hooks/useErrorToast";
import type { ExportFolder } from "@/hooks/useExportFolder";
import { useRevealWhen } from "@/hooks/useRevealWhen";
import { useRowButtonsBelow } from "@/hooks/useRowButtonsBelow";
import { settingsControlClass } from "@/components/settings";
import {
  useBackupExportStep,
  useLoadingBudget,
  useVaultBackups,
  type BackupExportJob,
} from "@upriv/shared/react";
import { BackupExportFolderStep, BackupExportProgress } from "./BackupExportPanel";

const backupCheckboxClass =
  "h-4 w-4 shrink-0 rounded border-outline-variant/50 bg-surface-container-high text-accent focus:ring-accent/40";

interface VaultBackupsModalProps {
  vault: VaultListItem | null;
  open: boolean;
  /** Back up now runs only while this vault is closed and idle (`vaultCanSaveBackupNow`). */
  canSaveNow: boolean;
  /** This vault's list-owned Back up now is in flight. Survives closing the modal. */
  saving: boolean;
  saveStartedAt: number | null;
  onSaveNow: () => void;
  /** Bumped when that job finishes so the open list reloads. */
  listRefreshToken: number;
  onClose: () => void;
  onCreateVaultFromBackup?: (stamp: string, fileName: string, saved?: boolean) => void;
  /** The folder a backup export writes into, kept by the vault list for the next one. */
  exportFolder: ExportFolder;
  /** The backup export in flight, of any vault. Survives closing the modal. */
  exportJob: BackupExportJob | null;
  /** Export these backups of this vault into `destDir`. */
  onExport: (keys: readonly string[], destDir: string) => void;
  /** Another export is running, so this one cannot start. */
  onExportBusy: () => void;
  /** Ask the running export to stop (`job_cancel`); core removes its unfinished file. */
  onStopExport: () => void;
}

export function VaultBackupsModal({
  vault,
  open,
  canSaveNow,
  saving,
  saveStartedAt,
  onSaveNow,
  listRefreshToken,
  onClose,
  onCreateVaultFromBackup,
  exportFolder,
  exportJob,
  onExport,
  onExportBusy,
  onStopExport,
}: VaultBackupsModalProps) {
  const { locale, t } = useTranslation();
  const { toast, dismiss, showError, errorText } = useErrorToast();
  const backupService = useBackupService();
  const vaultId = vault?.id ?? null;
  const { backups, deleteBackups, promoteToSave, isLoading, isBusy, error } = useVaultBackups(
    backupService,
    vaultId,
    open,
    listRefreshToken,
  );
  const saveBudget = useLoadingBudget(saving, LOADING_BUDGET_MS.vaultBackupSave, {
    startedAt: saveStartedAt ?? undefined,
  });

  const savedBackups = useMemo(() => backups.filter((entry) => entry.saved), [backups]);
  const standardBackups = useMemo(() => backups.filter((entry) => !entry.saved), [backups]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const confirmInputId = useId();
  const confirmRef = useRevealWhen<HTMLDivElement>(deleteTargets !== null);

  const rowKeys = useMemo(
    () => backups.map((entry) => backupEntryKey(entry, vaultId ?? "")),
    [backups, vaultId],
  );
  const exportStep = useBackupExportStep({
    folder: exportFolder,
    open,
    listed: rowKeys,
    busy: exportJob !== null,
    onBusy: onExportBusy,
    onStart: onExport,
  });
  const shownExport = exportJob !== null && exportJob.vaultId === vaultId ? exportJob : null;
  const exportingKeys = useMemo(() => new Set(shownExport?.keys), [shownExport?.keys]);
  const allSelected = backups.length > 0 && rowKeys.every((key) => selected.has(key));
  const someSelected = selected.size > 0;
  /** A single backup has nothing to multi-select: row actions cover it. */
  const selectable = backups.length > 1;
  const selectedStandardKeys = standardBackups
    .map((entry) => backupEntryKey(entry, vaultId ?? ""))
    .filter((key) => selected.has(key));
  const deleteCount = deleteTargets?.length ?? 0;
  const canConfirmDelete =
    vault !== null &&
    deleteTargets !== null &&
    deleteCount > 0 &&
    matchesBackupDeleteConfirmation(confirmText, vault.displayName, deleteCount);

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setDeleteTargets(null);
      setConfirmText("");
    }
  }, [open, vaultId]);

  useEffect(() => {
    setSelected((current) => {
      const next = new Set<string>();
      for (const key of current) {
        if (rowKeys.includes(key)) next.add(key);
      }
      return next;
    });
    setDeleteTargets(null);
    setConfirmText("");
  }, [rowKeys]);

  if (!open || !vault) return null;

  const handleClose = () => {
    setSelected(new Set());
    setDeleteTargets(null);
    setConfirmText("");
    onClose();
  };

  const toggleSelected = (stamp: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(stamp)) next.delete(stamp);
      else next.add(stamp);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(rowKeys));
  };

  const beginDelete = (stamps: string[]) => {
    if (stamps.length === 0) return;
    setDeleteTargets(stamps);
    setConfirmText("");
  };

  const cancelDelete = () => {
    setDeleteTargets(null);
    setConfirmText("");
  };

  const handleConfirmDelete = () => {
    if (!deleteTargets || !canConfirmDelete) return;
    const targets = deleteTargets;
    void deleteBackups(targets)
      .then(() => {
        setSelected((current) => {
          const next = new Set(current);
          for (const stamp of targets) next.delete(stamp);
          return next;
        });
        setDeleteTargets(null);
        setConfirmText("");
      })
      .catch((err) => {
        showError(err, "toast.backup_delete_failed");
      });
  };

  const handlePromoteToSave = (stamp: string) => {
    void promoteToSave([stamp]).catch((err) => {
      showError(err, "toast.backup_promote_failed");
    });
  };

  const exportStepHint = (keys: readonly string[]) =>
    t("vault.export.dialog.folder_hint", {
      filename: backupExportFilename(keys, vault.id),
      numbered: backupExportFilename(keys, vault.id, 2),
    });

  /** The folder step of `keys`, or the export already running for them. */
  const exportPanel = (keys: readonly string[] | null, running: BackupExportJob | null) => {
    const title = (count: number) =>
      count > 1 ? t("modal.backup.export_count", { count: String(count) }) : undefined;
    if (running) {
      return (
        <BackupExportProgress
          job={running}
          title={title(running.keys.length)}
          onStop={onStopExport}
        />
      );
    }
    if (!keys) return null;
    return (
      <BackupExportFolderStep
        folder={exportFolder}
        hint={exportStepHint(keys)}
        title={title(keys.length)}
        onConfirm={exportStep.confirm}
        onCancel={exportStep.cancel}
        onPicked={exportStep.picked}
      />
    );
  };

  const stepRowKey = exportStep.keys ? backupExportRowKey(exportStep.keys) : null;
  const runningRowKey = shownExport ? backupExportRowKey(shownExport.keys) : null;
  const rowExportPanel = (key: string) =>
    exportPanel(
      stepRowKey === key ? exportStep.keys : null,
      runningRowKey === key ? shownExport : null,
    );
  const listExportPanel = exportPanel(
    exportStep.keys && stepRowKey === null ? exportStep.keys : null,
    shownExport && runningRowKey === null ? shownExport : null,
  );
  const selectedKeys = rowKeys.filter((key) => selected.has(key));

  return (
    <Modal
      open={open}
      title={t("modal.backup.title")}
      titleIcon="archive"
      contextTitle={vault.displayName}
      onClose={handleClose}
      panelClassName="max-w-2xl"
      bodyScroll={false}
    >
      <p className="mb-4 text-sm text-on-surface-variant">{t("modal.backup.hint")}</p>

      {isLoading ? (
        <p className="py-10 text-center font-mono text-sm text-on-surface-variant">
          {t("modal.backup.loading")}
        </p>
      ) : error ? (
        <p className="py-10 text-center text-sm text-on-error-container">
          {errorText(error, "modal.backup.load_failed")}
        </p>
      ) : (
        <>
          {deleteTargets === null && selectable ? (
            <BackupListToolbar
              allSelected={allSelected}
              someSelected={someSelected}
              selectedCount={selected.size}
              onToggleSelectAll={toggleSelectAll}
              promoteCount={selectedStandardKeys.length}
              promoteDisabled={isBusy || selectedStandardKeys.some((key) => exportingKeys.has(key))}
              onPromoteSelected={() => {
                void promoteToSave(selectedStandardKeys).catch((err) => {
                  showError(err, "toast.backup_promote_failed");
                });
              }}
              onExport={() => exportStep.begin(selectedKeys)}
              deleteDisabled={selectedKeys.some((key) => exportingKeys.has(key))}
              onDeleteSelected={() => beginDelete(Array.from(selected))}
            />
          ) : null}

          {listExportPanel ? (
            <div className="mb-3 rounded-xl bg-surface-container px-4 py-3">{listExportPanel}</div>
          ) : null}

          {/* The one scroller: the hint, toolbar, and export stay put above it. */}
          <div className="modal-scroll-pane min-h-0 flex-1 space-y-5 overflow-y-auto pr-0.5">
            <BackupSection
              title={t("modal.backup.section.saves")}
              help={t("modal.backup.section.saves_help")}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  disabled={saving || !canSaveNow || isBusy || deleteTargets !== null}
                  onClick={onSaveNow}
                >
                  {saving ? t("modal.backup.backup_now_running") : t("modal.backup.backup_now")}
                </Button>
              }
              notice={
                saving ? (
                  saveBudget.visible ? (
                    <LoadingBudgetHint
                      budgetMs={saveBudget.budgetMs}
                      remainingMs={saveBudget.remainingMs}
                      layout="inline"
                    />
                  ) : null
                ) : canSaveNow ? null : (
                  <p className="text-xs text-on-surface-variant">
                    {t("modal.backup.backup_now_blocked")}
                  </p>
                )
              }
              emptyLabel={t("modal.backup.saves_empty")}
              entries={savedBackups}
              locale={locale}
              vaultId={vault?.id ?? ""}
              selected={selected}
              selectionDisabled={deleteTargets !== null}
              exportingKeys={exportingKeys}
              rowExportPanel={rowExportPanel}
              onToggleSelected={selectable ? toggleSelected : undefined}
              onExport={(key) => exportStep.begin([key])}
              onDelete={(stamp) => beginDelete([stamp])}
              onCreateVaultFromBackup={onCreateVaultFromBackup}
            />
            <BackupSection
              title={t("modal.backup.section.standard")}
              help={t("modal.backup.section.standard_help")}
              emptyLabel={t("modal.backup.standard_empty")}
              entries={standardBackups}
              locale={locale}
              vaultId={vault?.id ?? ""}
              selected={selected}
              selectionDisabled={deleteTargets !== null}
              exportingKeys={exportingKeys}
              rowExportPanel={rowExportPanel}
              onToggleSelected={selectable ? toggleSelected : undefined}
              onExport={(key) => exportStep.begin([key])}
              onDelete={(stamp) => beginDelete([stamp])}
              onCreateVaultFromBackup={onCreateVaultFromBackup}
              onPromoteToSave={handlePromoteToSave}
            />
          </div>
        </>
      )}

      {deleteTargets !== null ? (
        <div ref={confirmRef} className="mt-4 space-y-3 rounded-xl bg-surface-container px-4 py-4">
          <p className="text-sm text-on-surface-variant">
            {t("modal.backup.delete_confirm", { count: String(deleteCount) })}
          </p>
          <p className="font-mono text-xs text-on-surface-variant/80">
            {backupDeleteConfirmPhrase(vault.displayName, deleteCount)}
          </p>
          <input
            id={confirmInputId}
            type="text"
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={settingsControlClass}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={cancelDelete}>
              {t("action.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!canConfirmDelete || isBusy}
              onClick={handleConfirmDelete}
            >
              {t("action.delete")}
            </Button>
          </div>
        </div>
      ) : null}
      <Toast toast={toast} onDismiss={dismiss} />
    </Modal>
  );
}

interface BackupSectionProps {
  title: string;
  help: string;
  /** Beside the title, e.g. Back up now. */
  action?: ReactNode;
  /** Under the help text, e.g. why the action is unavailable. */
  notice?: ReactNode;
  emptyLabel: string;
  entries: VaultBackupEntry[];
  locale: string;
  vaultId: string;
  selected: Set<string>;
  selectionDisabled: boolean;
  /** The backups a running export reads: they cannot be moved or deleted until it ends. */
  exportingKeys: ReadonlySet<string>;
  /** Grows the row: its folder step or its running export. */
  rowExportPanel: (key: string) => ReactNode;
  onToggleSelected?: (stamp: string) => void;
  onExport: (stamp: string) => void;
  onDelete: (stamp: string) => void;
  onCreateVaultFromBackup?: (stamp: string, fileName: string, saved?: boolean) => void;
  onPromoteToSave?: (stamp: string) => void;
}

function BackupSection({
  title,
  help,
  action,
  notice,
  emptyLabel,
  entries,
  locale,
  vaultId,
  selected,
  selectionDisabled,
  exportingKeys,
  rowExportPanel,
  onToggleSelected,
  onExport,
  onDelete,
  onCreateVaultFromBackup,
  onPromoteToSave,
}: BackupSectionProps) {
  return (
    <section className="space-y-2">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-on-surface">{title}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-on-surface-variant">{help}</p>
          {notice ? <div className="mt-1">{notice}</div> : null}
        </div>
        {action}
      </div>
      {entries.length === 0 ? (
        <p className="rounded-xl bg-surface-container px-4 py-6 text-center text-xs text-on-surface-variant">
          {emptyLabel}
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => {
            const key = backupEntryKey(entry, vaultId);
            const fileName = backupEntryFileName(entry, vaultId);
            return (
              <BackupRow
                key={key}
                entry={entry}
                locale={locale}
                fileName={fileName}
                checked={Boolean(onToggleSelected) && selected.has(key)}
                selectionDisabled={selectionDisabled}
                exporting={exportingKeys.has(key)}
                exportPanel={rowExportPanel(key)}
                onToggleSelected={onToggleSelected ? () => onToggleSelected(key) : undefined}
                onExport={() => onExport(key)}
                onDelete={() => onDelete(key)}
                onCreateVaultFromBackup={
                  onCreateVaultFromBackup
                    ? () => onCreateVaultFromBackup(entry.stamp, fileName, Boolean(entry.saved))
                    : undefined
                }
                onPromoteToSave={onPromoteToSave ? () => onPromoteToSave(key) : undefined}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface BackupListToolbarProps {
  allSelected: boolean;
  someSelected: boolean;
  selectedCount: number;
  /** Selected standard backups that "Save" would promote. */
  promoteCount: number;
  promoteDisabled: boolean;
  onToggleSelectAll: () => void;
  onPromoteSelected: () => void;
  onExport: () => void;
  deleteDisabled: boolean;
  onDeleteSelected: () => void;
}

function BackupListToolbar({
  allSelected,
  someSelected,
  selectedCount,
  promoteCount,
  promoteDisabled,
  onToggleSelectAll,
  onPromoteSelected,
  onExport,
  deleteDisabled,
  onDeleteSelected,
}: BackupListToolbarProps) {
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
          className={backupCheckboxClass}
        />
        <span className="text-sm text-on-surface-variant">{t("modal.backup.select_all")}</span>
      </label>

      <div className="flex shrink-0 items-center gap-1 sm:ml-auto">
        {someSelected ? (
          <span className="pr-1 text-xs tabular-nums text-on-surface-variant">
            {t("modal.backup.selected_count", { count: String(selectedCount) })}
          </span>
        ) : null}
        {promoteCount > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={promoteDisabled}
            className="mr-0.5 h-8 shrink-0 px-2 text-xs sm:px-2.5"
            onClick={onPromoteSelected}
          >
            {t("modal.backup.promote_to_save")}
          </Button>
        ) : null}
        {someSelected ? (
          <IconButton
            label={t("modal.backup.export_selected")}
            size="row"
            variant="row-action"
            className="-mr-1 text-on-surface-variant hover:bg-accent/15 hover:text-accent"
            onClick={onExport}
          >
            <Icon name="download" size={18} />
          </IconButton>
        ) : null}
        {someSelected ? (
          <IconButton
            label={t("modal.backup.delete_selected")}
            size="row"
            variant="row-action"
            disabled={deleteDisabled}
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

interface BackupRowProps {
  entry: VaultBackupEntry;
  locale: string;
  fileName: string;
  checked: boolean;
  selectionDisabled: boolean;
  /** A running export reads this backup: it cannot be moved or deleted until it ends. */
  exporting: boolean;
  /** Under the row: this backup's folder step or running export. */
  exportPanel: ReactNode;
  /** Omitted when the list has a single entry: no checkbox. */
  onToggleSelected?: () => void;
  onExport: () => void;
  onDelete: () => void;
  onCreateVaultFromBackup?: () => void;
  onPromoteToSave?: () => void;
}

function BackupRow({
  entry,
  locale,
  fileName,
  checked,
  selectionDisabled,
  exporting,
  exportPanel,
  onToggleSelected,
  onExport,
  onDelete,
  onCreateVaultFromBackup,
  onPromoteToSave,
}: BackupRowProps) {
  const { t } = useTranslation();
  const checkboxId = useId();
  const exportPanelRef = useRevealWhen<HTMLDivElement>(Boolean(exportPanel));
  const rowRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLParagraphElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const buttonsBelow = useRowButtonsBelow(
    { row: rowRef, slot: titleRef, text: nameRef, beside: badgeRef },
    fileName,
  );

  return (
    <li
      className={[
        "rounded-xl border border-transparent transition-colors",
        "bg-surface-container",
        checked ? "border-accent/40" : "hover:bg-surface-container-high/80",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        ref={rowRef}
        className={[
          "flex min-h-14 gap-3 py-3 pl-4 pr-2 sm:py-3.5 sm:pl-4 sm:pr-3",
          buttonsBelow ? "flex-col items-stretch" : "items-center",
          selectionDisabled ? "pointer-events-none opacity-60" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {onToggleSelected ? (
            <input
              id={checkboxId}
              type="checkbox"
              checked={checked}
              disabled={selectionDisabled}
              onChange={onToggleSelected}
              className={[backupCheckboxClass, "disabled:opacity-40"].join(" ")}
            />
          ) : null}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-container-highest text-on-surface-variant">
            <Icon name="archive" size={18} />
          </div>
          <label
            htmlFor={onToggleSelected ? checkboxId : undefined}
            className={[
              "min-w-0 flex-1 select-none",
              selectionDisabled || !onToggleSelected ? "cursor-default" : "cursor-pointer",
            ].join(" ")}
          >
            <p ref={titleRef} className="flex min-w-0 items-center gap-2">
              <span ref={nameRef} className="truncate font-mono text-xs text-on-surface sm:text-sm">
                {fileName}
              </span>
              {entry.saved ? (
                <span
                  ref={badgeRef}
                  className="shrink-0 rounded bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent"
                >
                  {t("modal.backup.saved_badge")}
                </span>
              ) : null}
            </p>
            <p className="mt-0.5 text-xs text-on-surface-variant">
              {formatBackupDate(entry.createdAt, locale)}
              <span aria-hidden className="mx-1.5">
                ·
              </span>
              <span className="font-mono">{formatBytes(entry.sizeBytes)}</span>
            </p>
          </label>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-0.5">
          {onPromoteToSave ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={selectionDisabled || exporting}
              className="mr-0.5 h-8 shrink-0 px-2 text-xs sm:px-2.5"
              onClick={onPromoteToSave}
            >
              {t("modal.backup.promote_to_save")}
            </Button>
          ) : null}
          {onCreateVaultFromBackup ? (
            <IconButton
              label={t("action.create_vault_from_backup")}
              size="row"
              variant="row-action"
              disabled={selectionDisabled}
              className="-mr-1 text-on-surface-variant hover:bg-accent/15 hover:text-accent"
              onClick={onCreateVaultFromBackup}
            >
              <Icon name="add" size={18} />
            </IconButton>
          ) : null}
          <IconButton
            label={t("modal.backup.export")}
            size="row"
            variant="row-action"
            disabled={selectionDisabled || exporting}
            className="-mr-1 text-on-surface-variant hover:bg-accent/15 hover:text-accent"
            onClick={onExport}
          >
            <Icon name="download" size={18} />
          </IconButton>
          <IconButton
            label={t("action.delete")}
            size="row"
            variant="row-action"
            disabled={selectionDisabled || exporting}
            className="-mr-1 text-on-surface-variant hover:bg-error-container/20 hover:text-on-error-container"
            onClick={onDelete}
          >
            <Icon name="trash" size={18} />
          </IconButton>
        </div>
      </div>
      {exportPanel ? (
        <div ref={exportPanelRef} className="border-t border-outline-variant/20 px-4 py-3">
          {exportPanel}
        </div>
      ) : null}
    </li>
  );
}
