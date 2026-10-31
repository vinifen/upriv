import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  backupDeleteConfirmPhrase,
  backupEntryFileName,
  backupEntryKey,
  backupExportFilename,
  backupExportRowKey,
  formatBackupDate,
  formatBytes,
  LOADING_BUDGET_MS,
  matchesBackupDeleteConfirmation,
  type VaultBackupEntry,
  type VaultListItem,
} from "@upriv/shared";
import { useBackupService } from "@/platform/services";
import type { ExportFolder } from "@/hooks/useExportFolder";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import {
  Button,
  Checkbox,
  IconButton,
  LoadingBudgetHint,
  Modal,
  ModalFooterActions,
  TextWidthProbe,
  Toast,
} from "@/components/ui";
import { ThemedInput } from "@/components/settings";
import { Icon } from "@/components/icons";
import { useTheme } from "@/theme";
import { colorAlpha, radii, spacing } from "@/theme/tokens";
import {
  useBackupExportStep,
  useLoadingBudget,
  useRowButtonStack,
  useToast,
  type BackupExportJob,
} from "@upriv/shared/react";
import { useVaultBackups } from "@upriv/shared/react";
import { BackupExportFolderStep, BackupExportProgress } from "./BackupExportPanel";

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
  const { colors, typography } = useTheme();
  const { toast, show: showToast, dismiss: dismissToast } = useToast();
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
        showToast(t(mobileErrorI18nKey(err, "toast.backup_delete_failed")));
      });
  };

  const handlePromoteToSave = (stamp: string) => {
    void promoteToSave([stamp]).catch((err) => {
      showToast(t(mobileErrorI18nKey(err, "toast.backup_promote_failed")));
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
      overlay={<Toast toast={toast} onDismiss={dismissToast} />}
    >
      <Text style={[typography.bodyMuted, styles.hint]}>{t("modal.backup.hint")}</Text>

      {isLoading ? (
        <Text style={[typography.mono, styles.empty]}>{t("modal.backup.loading")}</Text>
      ) : error ? (
        <Text style={[styles.empty, { color: colors.onErrorContainer }]}>
          {t(mobileErrorI18nKey(error, "modal.backup.load_failed"))}
        </Text>
      ) : (
        <View style={styles.list}>
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
                  showToast(t(mobileErrorI18nKey(err, "toast.backup_promote_failed")));
                });
              }}
              onExport={() => exportStep.begin(selectedKeys)}
              deleteDisabled={selectedKeys.some((key) => exportingKeys.has(key))}
              onDeleteSelected={() => beginDelete(Array.from(selected))}
            />
          ) : null}

          {listExportPanel ? (
            <View style={[styles.listExport, { backgroundColor: colors.surfaceContainer }]}>
              {listExportPanel}
            </View>
          ) : null}

          <BackupSection
            title={t("modal.backup.section.saves")}
            help={t("modal.backup.section.saves_help")}
            action={
              <Button
                label={saving ? t("modal.backup.backup_now_running") : t("modal.backup.backup_now")}
                variant="secondary"
                size="sm"
                busy={saving}
                disabled={saving || !canSaveNow || isBusy || deleteTargets !== null}
                onPress={onSaveNow}
              />
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
                <Text style={typography.caption}>{t("modal.backup.backup_now_blocked")}</Text>
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
        </View>
      )}

      {deleteTargets !== null ? (
        <View style={[styles.confirmCard, { backgroundColor: colors.surfaceContainer }]}>
          <Text style={typography.bodyMuted}>
            {t("modal.backup.delete_confirm", { count: String(deleteCount) })}
          </Text>
          <Text style={[typography.mono, styles.confirmPhrase]}>
            {backupDeleteConfirmPhrase(vault.displayName, deleteCount)}
          </Text>
          <ThemedInput
            value={confirmText}
            onChangeText={setConfirmText}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            importantForAutofill="no"
          />
          <ModalFooterActions layout="dialog">
            <Button label={t("action.cancel")} variant="ghost" size="sm" onPress={cancelDelete} />
            <Button
              label={t("action.delete")}
              variant="danger"
              size="sm"
              disabled={!canConfirmDelete || isBusy}
              onPress={handleConfirmDelete}
            />
          </ModalFooterActions>
        </View>
      ) : null}
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
  const { colors, typography } = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionCopy}>
          <Text style={[typography.body, { fontWeight: "500" }]}>{title}</Text>
          <Text style={[typography.caption, styles.sectionHelp]}>{help}</Text>
          {notice ? <View style={styles.sectionNotice}>{notice}</View> : null}
        </View>
        {action}
      </View>
      {entries.length === 0 ? (
        <Text
          style={[
            typography.caption,
            styles.sectionEmpty,
            { backgroundColor: colors.surfaceContainer, color: colors.onSurfaceVariant },
          ]}
        >
          {emptyLabel}
        </Text>
      ) : (
        <View style={styles.sectionList}>
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
        </View>
      )}
    </View>
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
  const { typography } = useTheme();

  return (
    <View style={styles.toolbar}>
      <Pressable style={styles.toolbarSelect} onPress={onToggleSelectAll}>
        <Checkbox
          checked={allSelected}
          indeterminate={someSelected && !allSelected}
          onChange={onToggleSelectAll}
          label={t("modal.backup.select_all")}
        />
        <Text style={typography.bodyMuted}>{t("modal.backup.select_all")}</Text>
      </Pressable>
      {someSelected ? (
        <View style={styles.toolbarActions}>
          <Text style={[typography.caption, styles.selectedCount]}>
            {t("modal.backup.selected_count", { count: String(selectedCount) })}
          </Text>
          {promoteCount > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={promoteDisabled}
              label={t("modal.backup.promote_to_save")}
              onPress={onPromoteSelected}
            />
          ) : null}
          <IconButton
            label={t("modal.backup.export_selected")}
            icon="download"
            size={18}
            tone="muted"
            onPress={onExport}
          />
          <IconButton
            label={t("modal.backup.delete_selected")}
            icon="trash"
            size={18}
            tone="muted"
            disabled={deleteDisabled}
            onPress={onDeleteSelected}
          />
        </View>
      ) : null}
    </View>
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
  const { colors, typography } = useTheme();
  const { stacked, measure } = useRowButtonStack();

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.surfaceContainer,
          borderColor: checked ? colorAlpha(colors.accent, 0.4) : "transparent",
        },
      ]}
    >
      <View
        style={[
          styles.rowMain,
          stacked ? styles.rowMainStacked : null,
          { opacity: selectionDisabled ? 0.6 : 1 },
        ]}
        pointerEvents={selectionDisabled ? "none" : "auto"}
        onLayout={(event) => measure("rowWidth", event.nativeEvent.layout.width)}
      >
        <View style={styles.rowHead}>
          {onToggleSelected ? (
            <Checkbox
              checked={checked}
              disabled={selectionDisabled}
              onChange={onToggleSelected}
              label={fileName}
            />
          ) : null}
          <View style={[styles.rowIcon, { backgroundColor: colors.surfaceContainerHighest }]}>
            <Icon name="archive" size={18} color={colors.onSurfaceVariant} />
          </View>
          <Pressable
            style={styles.rowCopy}
            onPress={onToggleSelected}
            disabled={selectionDisabled || !onToggleSelected}
            onLayout={(event) => measure("slotWidth", event.nativeEvent.layout.width)}
          >
            <View style={styles.rowTitleRow}>
              <TextWidthProbe
                text={fileName}
                style={[typography.mono, styles.rowTitle]}
                onWidth={(width) => measure("textWidth", width)}
              />
              <Text
                style={[typography.mono, styles.rowTitle, { color: colors.onSurface }]}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {fileName}
              </Text>
              {entry.saved ? (
                <View
                  style={[styles.badge, { backgroundColor: colorAlpha(colors.accent, 0.15) }]}
                  onLayout={(event) => measure("besideWidth", event.nativeEvent.layout.width)}
                >
                  <Text style={[styles.badgeText, { color: colors.accent }]}>
                    {t("modal.backup.saved_badge")}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={typography.caption}>
              {formatBackupDate(entry.createdAt, locale)}
              <Text> · </Text>
              <Text style={typography.mono}>{formatBytes(entry.sizeBytes)}</Text>
            </Text>
          </Pressable>
        </View>
        <View style={styles.rowActions}>
          {onPromoteToSave ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={selectionDisabled || exporting}
              label={t("modal.backup.promote_to_save")}
              onPress={onPromoteToSave}
            />
          ) : null}
          {onCreateVaultFromBackup ? (
            <IconButton
              label={t("action.create_vault_from_backup")}
              icon="add"
              size={18}
              tone="muted"
              disabled={selectionDisabled}
              onPress={onCreateVaultFromBackup}
            />
          ) : null}
          <IconButton
            label={t("modal.backup.export")}
            icon="download"
            size={18}
            tone="muted"
            disabled={selectionDisabled || exporting}
            onPress={onExport}
          />
          <IconButton
            label={t("action.delete")}
            icon="trash"
            size={18}
            tone="muted"
            disabled={selectionDisabled || exporting}
            onPress={onDelete}
          />
        </View>
      </View>
      {exportPanel ? <View style={styles.rowExport}>{exportPanel}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: spacing.md },
  list: { gap: spacing.lg },
  empty: { textAlign: "center", paddingVertical: 40, fontSize: 14 },
  toolbar: {
    minHeight: 32,
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
  listExport: {
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  sectionCopy: { flex: 1, minWidth: 0 },
  sectionHelp: { marginTop: 2, lineHeight: 18 },
  sectionNotice: { marginTop: spacing.xs },
  sectionEmpty: {
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    textAlign: "center",
  },
  sectionList: { gap: spacing.sm },
  row: {
    borderRadius: radii.md,
    borderWidth: 1,
  },
  rowMain: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
  },
  rowMainStacked: { flexDirection: "column", alignItems: "stretch", gap: spacing.xs },
  rowHead: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  rowExport: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rowCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  rowTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowTitle: { flexShrink: 1 },
  badge: {
    flexShrink: 0,
    borderRadius: radii.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: spacing.xs,
    marginLeft: "auto",
  },
  confirmCard: {
    marginTop: spacing.lg,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  confirmPhrase: { opacity: 0.8 },
});
