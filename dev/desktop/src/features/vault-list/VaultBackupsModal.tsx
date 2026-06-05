import { useEffect, useId, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Button, IconButton, Modal } from "@/components/ui";
import { formatBytes } from "@/lib/formatBytes";
import { useTranslation } from "@/i18n";
import { formatBackupDate } from "./backupFormat";
import { downloadBackupsZip } from "./downloadBackupsZip";
import type { VaultBackupEntry } from "./backupTypes";
import { useVaultBackups } from "./useVaultBackups";
import type { VaultListItem } from "./types";

const backupCheckboxClass =
  "h-4 w-4 shrink-0 rounded border-outline-variant/50 bg-surface-container-high text-accent focus:ring-accent/50";

interface VaultBackupsModalProps {
  vault: VaultListItem | null;
  open: boolean;
  onClose: () => void;
}

function matchesDeleteConfirmation(
  input: string,
  count: number,
  vaultId: string,
): boolean {
  const trimmed = input.trim();
  if (count === 1) return trimmed === vaultId;
  return trimmed.toLowerCase() === `delete ${count}`;
}

export function VaultBackupsModal({ vault, open, onClose }: VaultBackupsModalProps) {
  const { locale, t } = useTranslation();
  const vaultId = vault?.id ?? null;
  const { backups, deleteBackups } = useVaultBackups(vaultId, open);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const confirmInputId = useId();

  const allFilenames = useMemo(() => backups.map((entry) => entry.filename), [backups]);
  const allSelected =
    backups.length > 0 && allFilenames.every((filename) => selected.has(filename));
  const someSelected = selected.size > 0;
  const deleteCount = deleteTargets?.length ?? 0;
  const isSingleDelete = deleteCount === 1;
  const canConfirmDelete =
    vault !== null &&
    deleteTargets !== null &&
    deleteCount > 0 &&
    matchesDeleteConfirmation(confirmText, deleteCount, vault.id);

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
      for (const filename of current) {
        if (allFilenames.includes(filename)) next.add(filename);
      }
      return next;
    });
    setDeleteTargets(null);
    setConfirmText("");
  }, [allFilenames]);

  if (!open || !vault) return null;

  const handleClose = () => {
    setSelected(new Set());
    setDeleteTargets(null);
    setConfirmText("");
    onClose();
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
    setConfirmText("");
  };

  const cancelDelete = () => {
    setDeleteTargets(null);
    setConfirmText("");
  };

  const handleConfirmDelete = () => {
    if (!deleteTargets || !canConfirmDelete) return;
    deleteBackups(deleteTargets);
    setSelected((current) => {
      const next = new Set(current);
      for (const filename of deleteTargets) next.delete(filename);
      return next;
    });
    setDeleteTargets(null);
    setConfirmText("");
  };

  const handleDownload = () => {
    const targets = someSelected
      ? backups.filter((entry) => selected.has(entry.filename))
      : backups;
    if (targets.length === 0) return;
    downloadBackupsZip(targets, t("modal.backup.download_zip_name", { id: vault.id }));
  };

  const handleDownloadOne = (filename: string) => {
    const entry = backups.find((item) => item.filename === filename);
    if (!entry) return;
    downloadBackupsZip([entry], t("modal.backup.download_zip_name", { id: vault.id }));
  };

  return (
    <Modal
      open={open}
      title={t("modal.backup.title", { name: vault.displayName })}
      onClose={handleClose}
      panelClassName="max-w-2xl"
    >
      <p className="mb-4 text-sm text-on-surface-variant">{t("modal.backup.hint")}</p>

      {backups.length === 0 ? (
        <p className="py-10 text-center font-mono text-sm text-on-surface-variant">
          {t("modal.backup.empty")}
        </p>
      ) : (
        <>
          {deleteTargets === null ? (
            <BackupListToolbar
              allSelected={allSelected}
              someSelected={someSelected}
              selectedCount={selected.size}
              onToggleSelectAll={toggleSelectAll}
              onDownload={handleDownload}
              onDeleteSelected={() => beginDelete(Array.from(selected))}
            />
          ) : null}

          <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
            {backups.map((entry) => (
              <BackupRow
                key={entry.filename}
                entry={entry}
                locale={locale}
                checked={selected.has(entry.filename)}
                selectionDisabled={deleteTargets !== null}
                onToggleSelected={() => toggleSelected(entry.filename)}
                onDownload={() => handleDownloadOne(entry.filename)}
                onDelete={() => beginDelete([entry.filename])}
              />
            ))}
          </ul>
        </>
      )}

      {deleteTargets !== null ? (
        <div className="mt-4 rounded-xl border border-outline-variant/20 bg-surface-container px-4 py-4">
          <p className="mb-2 text-sm text-on-surface-variant">
            {isSingleDelete
              ? t("modal.backup.delete_confirm_one")
              : t("modal.backup.delete_confirm_many", { count: String(deleteCount) })}
          </p>
          <p className="mb-3 font-mono text-xs text-on-surface-variant/80">
            {isSingleDelete
              ? vault.id
              : t("modal.backup.delete_phrase_many", { count: String(deleteCount) })}
          </p>
          <input
            id={confirmInputId}
            type="text"
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="mb-3 w-full rounded-lg border-0 bg-surface-container-high px-3 py-2.5 text-sm text-on-surface outline-none ring-1 ring-outline-variant/40 focus:ring-accent/50"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={cancelDelete}>
              {t("action.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!canConfirmDelete}
              onClick={handleConfirmDelete}
            >
              {t("action.delete")}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

interface BackupListToolbarProps {
  allSelected: boolean;
  someSelected: boolean;
  selectedCount: number;
  onToggleSelectAll: () => void;
  onDownload: () => void;
  onDeleteSelected: () => void;
}

function BackupListToolbar({
  allSelected,
  someSelected,
  selectedCount,
  onToggleSelectAll,
  onDownload,
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
        <Button variant="secondary" size="sm" onClick={onDownload}>
          {someSelected ? t("modal.backup.download_selected") : t("modal.backup.download_all")}
        </Button>
        {someSelected ? (
          <IconButton
            label={t("modal.backup.delete_selected")}
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

interface BackupRowProps {
  entry: VaultBackupEntry;
  locale: string;
  checked: boolean;
  selectionDisabled: boolean;
  onToggleSelected: () => void;
  onDownload: () => void;
  onDelete: () => void;
}

function BackupRow({
  entry,
  locale,
  checked,
  selectionDisabled,
  onToggleSelected,
  onDownload,
  onDelete,
}: BackupRowProps) {
  const { t } = useTranslation();
  const checkboxId = useId();

  return (
    <li
      className={[
        "flex min-h-14 items-center gap-3 rounded-xl border border-transparent py-3 pl-4 pr-2 transition-colors sm:py-3.5 sm:pl-4 sm:pr-3",
        "bg-surface-container",
        checked ? "border-accent/40" : "hover:bg-surface-container-high/80",
        selectionDisabled ? "pointer-events-none opacity-60" : "",
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
        className={[backupCheckboxClass, "disabled:opacity-40"].join(" ")}
      />
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-container-highest text-on-surface-variant">
        <Icon name="archive" size={18} />
      </div>
      <label
        htmlFor={checkboxId}
        className={[
          "min-w-0 flex-1 select-none",
          selectionDisabled ? "cursor-default" : "cursor-pointer",
        ].join(" ")}
      >
        <p className="truncate font-mono text-xs text-on-surface sm:text-sm">{entry.filename}</p>
        <p className="mt-0.5 text-xs text-on-surface-variant">
          {formatBackupDate(entry.createdAt, locale)}
          <span aria-hidden className="mx-1.5">
            ·
          </span>
          <span className="font-mono">{formatBytes(entry.sizeBytes)}</span>
        </p>
      </label>
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton
          label={t("action.download")}
          size="row"
          variant="row-action"
          disabled={selectionDisabled}
          className="-mr-1 text-on-surface-variant hover:bg-accent/15 hover:text-accent"
          onClick={onDownload}
        >
          <Icon name="download" size={18} />
        </IconButton>
        <IconButton
          label={t("action.delete")}
          size="row"
          variant="row-action"
          disabled={selectionDisabled}
          className="-mr-1 text-on-surface-variant hover:bg-error-container/20 hover:text-on-error-container"
          onClick={onDelete}
        >
          <Icon name="trash" size={18} />
        </IconButton>
      </div>
    </li>
  );
}
