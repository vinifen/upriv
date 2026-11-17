import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BACKUP_NAME_MAX_CHARS,
  backupDeleteConfirmPhrase,
  backupExportFilename,
  backupExportRowKey,
  backupListSections,
  deviceName,
  backupSectionSelection,
  formatBackupDate,
  fileNameOfPath,
  formatBytes,
  matchesBackupDeleteConfirmation,
  normalizeBackupName,
  toggleBackupSection,
  type BackupListSection,
  type BackupSectionKind,
  type BackupSectionSelection,
  type VaultBackupEntry,
  type VaultListItem,
} from "@upriv/shared";
import { useBackupService } from "@/platform/services";
import type { ExportFolder } from "@/hooks/useExportFolder";
import { useTranslation, type I18nKey } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { RevealPathButton, useRevealFolder } from "@/components/RevealPathButton";
import { shownPath } from "@/components/folder-list";
import {
  Button,
  Checkbox,
  DropdownPanel,
  ElapsedTime,
  IconButton,
  JobStopButton,
  MenuActionItem,
  Modal,
  ModalFooterActions,
  TextWidthProbe,
  Toast,
} from "@/components/ui";
import { SettingsAccordionSection, ThemedInput } from "@/components/settings";
import { Icon } from "@/components/icons";
import { useTheme } from "@/theme";
import { colorAlpha, radii, spacing } from "@/theme/tokens";
import {
  useBackupExportStep,
  useRowButtonStack,
  useToast,
  type BackupExportJob,
  type VaultBackupJob,
} from "@upriv/shared/react";
import { useVaultBackups } from "@upriv/shared/react";
import { BackupExportFolderStep, BackupExportProgress } from "./BackupExportPanel";

interface VaultBackupsModalProps {
  vault: VaultListItem | null;
  open: boolean;
  /** Back up now runs only while this vault is closed and idle (`vaultCanSaveBackupNow`). */
  canSaveNow: boolean;
  /** This vault's list-owned Back up now in flight. Survives closing the modal. */
  saveJob: VaultBackupJob | null;
  onSaveNow: () => void;
  /** Ask the running Back up now to stop; core removes its unfinished zip. */
  onStopSave: () => void;
  /** Bumped when that job finishes so the open list reloads. */
  listRefreshToken: number;
  onClose: () => void;
  onCreateVaultFromBackup?: (backup: VaultBackupEntry) => void;
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
  saveJob,
  onSaveNow,
  onStopSave,
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
  const {
    sections: folders,
    deleteBackups,
    promoteToSave,
    renameBackup,
    forgetFolder,
    resetBackups,
    isLoading,
    isBusy,
    error,
  } = useVaultBackups(backupService, vaultId, open, listRefreshToken);
  const backups = useMemo(() => folders.flatMap((folder) => folder.entries), [folders]);
  const sections = useMemo(() => backupListSections({ sections: folders }), [folders]);
  const standardBackups = useMemo(() => backups.filter((entry) => !entry.saved), [backups]);
  /** The backup whose name is being edited. */
  const [renaming, setRenaming] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const rowKeys = useMemo(() => backups.map((entry) => entry.key), [backups]);
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
  const someSelected = selected.size > 0;
  /** A single backup has nothing to multi-select: row actions cover it. */
  const selectable = backups.length > 1;
  const selectedStandardKeys = standardBackups
    .map((entry) => entry.key)
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
      setRenaming(null);
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

  const toggleSelected = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSection = (keys: readonly string[]) => {
    setSelected((current) => toggleBackupSection(current, keys));
  };

  const beginDelete = (keys: string[]) => {
    if (keys.length === 0) return;
    setDeleteTargets(keys);
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
          for (const key of targets) next.delete(key);
          return next;
        });
        setDeleteTargets(null);
        setConfirmText("");
      })
      .catch((err: unknown) => {
        showToast(t(mobileErrorI18nKey(err, "toast.backup_delete_failed")));
      });
  };

  const handlePromoteToSave = (key: string) => {
    void promoteToSave([key]).catch((err: unknown) => {
      showToast(t(mobileErrorI18nKey(err, "toast.backup_promote_failed")));
    });
  };

  const handleRename = (key: string, name: string) => {
    void renameBackup(key, normalizeBackupName(name))
      .then(() => setRenaming(null))
      .catch((err: unknown) => {
        showToast(t(mobileErrorI18nKey(err, "toast.backup_rename_failed")));
      });
  };

  const handleForget = (folder: string) => {
    void forgetFolder(folder).catch((err: unknown) => {
      showToast(t(mobileErrorI18nKey(err, "toast.backup_forget_failed")));
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
  const selectionBar =
    deleteTargets === null && someSelected ? (
      <BackupSelectionBar
        selectedCount={selected.size}
        promoteCount={selectedStandardKeys.length}
        promoteDisabled={isBusy || selectedStandardKeys.some((key) => exportingKeys.has(key))}
        onPromoteSelected={() => {
          void promoteToSave(selectedStandardKeys).catch((err: unknown) => {
            showToast(t(mobileErrorI18nKey(err, "toast.backup_promote_failed")));
          });
        }}
        onExport={() => exportStep.begin(selectedKeys)}
        deleteDisabled={selectedKeys.some((key) => exportingKeys.has(key))}
        onDeleteSelected={() => beginDelete(selectedKeys)}
      />
    ) : null;
  // The selection's actions and an export of several sit under the list, so
  // choosing a row never moves the rows.
  const footer =
    listExportPanel || selectionBar ? (
      <View style={styles.footer}>
        {listExportPanel ? (
          <View style={[styles.listExport, { backgroundColor: colors.surfaceContainer }]}>
            {listExportPanel}
          </View>
        ) : null}
        {selectionBar}
      </View>
    ) : undefined;

  return (
    <Modal
      open={open}
      title={t("modal.backup.title")}
      titleIcon="archive"
      contextTitle={vault.displayName}
      onClose={handleClose}
      panelClassName="max-w-2xl"
      overlay={<Toast toast={toast} onDismiss={dismissToast} />}
      footer={footer}
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
          <View style={styles.saveRow}>
            <View style={styles.saveStatus}>
              {saveJob ? (
                <View style={styles.saveRunning}>
                  <Text style={typography.caption}>
                    {saveJob.startedAt === null
                      ? t("vault.status.queued")
                      : t("modal.backup.backup_now_running")}
                  </Text>
                  {saveJob.stoppingSince === null ? (
                    <ElapsedTime startedAt={saveJob.startedAt} layout="inline" />
                  ) : null}
                </View>
              ) : canSaveNow ? null : (
                <Text style={typography.caption}>{t("modal.backup.backup_now_blocked")}</Text>
              )}
            </View>
            {saveJob ? (
              <JobStopButton
                size="sm"
                stoppingSince={saveJob.stoppingSince}
                stoppable={saveJob.progress?.stoppable ?? true}
                onStop={onStopSave}
              />
            ) : (
              <Button
                label={t("modal.backup.backup_now")}
                variant="secondary"
                size="sm"
                disabled={!canSaveNow || isBusy || deleteTargets !== null}
                onPress={onSaveNow}
              />
            )}
          </View>

          {sections.length === 0 ? (
            <Text style={[typography.caption, styles.empty]}>{t("modal.backup.empty")}</Text>
          ) : null}
          {sections.map((section) => (
            <BackupSection
              key={section.id}
              section={section}
              selection={backupSectionSelection(section.keys, selected)}
              onToggleSection={selectable ? () => toggleSection(section.keys) : undefined}
              locale={locale}
              selected={selected}
              selectionDisabled={deleteTargets !== null}
              exportingKeys={exportingKeys}
              rowExportPanel={rowExportPanel}
              onToggleSelected={selectable ? toggleSelected : undefined}
              onExport={(key) => exportStep.begin([key])}
              onDelete={(key) => beginDelete([key])}
              onCreateVaultFromBackup={onCreateVaultFromBackup}
              onPromoteToSave={handlePromoteToSave}
              renaming={renaming}
              busy={isBusy}
              onRenameStart={(key) => setRenaming(key)}
              onRenameCancel={() => setRenaming(null)}
              onRename={handleRename}
              onRetry={() => void resetBackups().catch(() => undefined)}
              onForget={handleForget}
            />
          ))}
        </View>
      )}

      {deleteTargets !== null ? (
        <View style={[styles.confirmCard, { backgroundColor: colors.surfaceContainer }]}>
          <Text style={typography.bodyMuted}>
            {deleteCount === 1
              ? t("modal.backup.delete_list_one", { name: unbrokenName(deleteTargets[0]) })
              : t("modal.backup.delete_list", {
                  count: String(deleteCount),
                  names: deleteTargets.map(unbrokenName).join(", "),
                })}
          </Text>
          <Text style={typography.bodyMuted}>
            {deleteCount === 1
              ? t("modal.backup.delete_confirm_one")
              : t("modal.backup.delete_confirm", { count: String(deleteCount) })}
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

/**
 * A backup's file name with non-breaking hyphens, so a line never ends inside
 * it: the name moves to the next line whole.
 */
function unbrokenName(key: string): string {
  return fileNameOfPath(key).replaceAll("-", "\u2011");
}

interface BackupSectionProps {
  section: BackupListSection;
  selection: BackupSectionSelection;
  /** Absent while there is a single backup: row actions cover it. */
  onToggleSection?: () => void;
  locale: string;
  selected: Set<string>;
  selectionDisabled: boolean;
  /** The backups a running export reads: they cannot be moved or deleted until it ends. */
  exportingKeys: ReadonlySet<string>;
  /** Grows the row: its folder step or its running export. */
  rowExportPanel: (key: string) => ReactNode;
  onToggleSelected?: (key: string) => void;
  onExport: (key: string) => void;
  onDelete: (key: string) => void;
  onCreateVaultFromBackup?: (backup: VaultBackupEntry) => void;
  onPromoteToSave?: (key: string) => void;
  /** The backup whose name is being edited. */
  renaming: string | null;
  busy: boolean;
  onRenameStart: (key: string) => void;
  onRenameCancel: () => void;
  onRename: (key: string, name: string) => void;
  /** Check every folder again. */
  onRetry: () => void;
  /** Stop listing a folder that cannot be reached. */
  onForget: (folder: string) => void;
}

const SECTION_TITLE_KEYS: Record<BackupSectionKind, I18nKey> = {
  data_folder: "modal.backup.group.data_folder",
  in_use: "modal.backup.group.in_use",
  other: "modal.backup.group.other",
};

/**
 * Every backup in one folder as a collapsible card like the settings
 * sections: its Saves, then its Standard backups, with one select-all. A
 * folder Upriv no longer writes to is dimmed; one that cannot be reached
 * shows why, with Retry and Forget.
 */
function BackupSection({
  section,
  selection,
  onToggleSection,
  locale,
  selected,
  selectionDisabled,
  exportingKeys,
  rowExportPanel,
  onToggleSelected,
  onExport,
  onDelete,
  onCreateVaultFromBackup,
  onPromoteToSave,
  renaming,
  busy,
  onRenameStart,
  onRenameCancel,
  onRename,
  onRetry,
  onForget,
}: BackupSectionProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const title = t(SECTION_TITLE_KEYS[section.kind]);
  const reachable = section.status === "ok";
  return (
    <SettingsAccordionSection
      title={title}
      defaultOpen
      aside={
        <>
          <Text style={[typography.caption, { color: colors.onSurfaceVariant }]}>
            {section.keys.length}
          </Text>
          {onToggleSection ? (
            <Checkbox
              checked={selection === "all"}
              indeterminate={selection === "some"}
              disabled={selectionDisabled}
              onChange={onToggleSection}
              label={t("modal.backup.select_section", { section: title })}
            />
          ) : null}
        </>
      }
    >
      {section.folder ? (
        <View style={styles.folderRow}>
          <Text
            style={[typography.mono, styles.folderPath, { color: colors.onSurfaceVariant }]}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {shownPath(section.folder)}
          </Text>
          {reachable ? <RevealPathButton path={section.folder} /> : null}
        </View>
      ) : null}
      {section.device ? (
        <Text style={typography.caption}>
          {t("modal.backup.folder.written_by", {
            device: deviceName(section.device.id, section.device.system, t),
          })}
        </Text>
      ) : null}
      {section.kind === "other" ? (
        <Text style={typography.caption}>{t("modal.backup.folder.not_in_use")}</Text>
      ) : null}
      {reachable ? null : (
        <View style={[styles.folderProblem, { borderColor: colors.outlineVariant }]}>
          <Text
            accessibilityRole="alert"
            style={[typography.body, { color: colors.onErrorContainer }]}
          >
            {t(`folder_list.status.${section.status}`)}
          </Text>
          <Text style={typography.caption}>{t("modal.backup.folder.forget_hint")}</Text>
          <ModalFooterActions layout="dialog">
            <Button
              label={t("modal.backup.folder.forget")}
              variant="ghost"
              size="sm"
              disabled={busy}
              onPress={() => onForget(section.id)}
            />
            <Button
              label={t("action.retry")}
              variant="secondary"
              size="sm"
              disabled={busy}
              onPress={onRetry}
            />
          </ModalFooterActions>
        </View>
      )}
      <View style={section.kind === "other" ? styles.notInUse : undefined}>
        {section.groups.map((group) => (
          <View key={group.saved ? "saves" : "standard"} style={styles.tier}>
            <View>
              <Text style={[typography.body, { fontWeight: "500" }]}>
                {t(group.saved ? "modal.backup.section.saves" : "modal.backup.section.standard")}
              </Text>
              <Text style={[typography.caption, styles.sectionHelp]}>
                {t(
                  group.saved
                    ? "modal.backup.section.saves_help"
                    : "modal.backup.section.standard_help",
                )}
              </Text>
            </View>
            <View style={styles.sectionList}>
              {group.entries.map((entry) => {
                const key = entry.key;
                return (
                  <BackupRow
                    key={key}
                    entry={entry}
                    locale={locale}
                    checked={Boolean(onToggleSelected) && selected.has(key)}
                    selectionDisabled={selectionDisabled}
                    exporting={exportingKeys.has(key)}
                    folderReachable={reachable}
                    exportPanel={rowExportPanel(key)}
                    onToggleSelected={onToggleSelected ? () => onToggleSelected(key) : undefined}
                    onExport={() => onExport(key)}
                    onDelete={() => onDelete(key)}
                    onCreateVaultFromBackup={
                      onCreateVaultFromBackup ? () => onCreateVaultFromBackup(entry) : undefined
                    }
                    onPromoteToSave={
                      onPromoteToSave && !group.saved ? () => onPromoteToSave(key) : undefined
                    }
                    renameOpen={renaming === key}
                    busy={busy}
                    onRenameStart={() => onRenameStart(key)}
                    onRenameCancel={onRenameCancel}
                    onRename={(name) => onRename(key, name)}
                  />
                );
              })}
            </View>
          </View>
        ))}
      </View>
    </SettingsAccordionSection>
  );
}

interface BackupSelectionBarProps {
  selectedCount: number;
  /** Selected standard backups that "Save" would promote. */
  promoteCount: number;
  promoteDisabled: boolean;
  onPromoteSelected: () => void;
  onExport: () => void;
  deleteDisabled: boolean;
  onDeleteSelected: () => void;
}

/** What to do with the backups chosen in any section. Shown only while some are. */
function BackupSelectionBar({
  selectedCount,
  promoteCount,
  promoteDisabled,
  onPromoteSelected,
  onExport,
  deleteDisabled,
  onDeleteSelected,
}: BackupSelectionBarProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();

  return (
    <View style={[styles.selectionBar, { backgroundColor: colors.surfaceContainer }]}>
      <Text style={[typography.body, styles.selectedCount]} accessibilityRole="text">
        {t("modal.backup.selected_count", { count: String(selectedCount) })}
      </Text>
      <View style={styles.selectionActions}>
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
    </View>
  );
}

interface BackupRowProps {
  entry: VaultBackupEntry;
  locale: string;
  checked: boolean;
  selectionDisabled: boolean;
  /** A running export reads this backup: it cannot be moved or deleted until it ends. */
  exporting: boolean;
  /** Its folder answers, so Open folder can show it. */
  folderReachable: boolean;
  /** Under the row: this backup's folder step or running export. */
  exportPanel: ReactNode;
  /** Omitted when the list has a single entry: no checkbox. */
  onToggleSelected?: () => void;
  onExport: () => void;
  onDelete: () => void;
  onCreateVaultFromBackup?: () => void;
  onPromoteToSave?: () => void;
  /** The name editor is open under the row. */
  renameOpen: boolean;
  busy: boolean;
  onRenameStart: () => void;
  onRenameCancel: () => void;
  onRename: (name: string) => void;
}

/**
 * One backup (desktop `BackupRow` parity): Save on the row, its other
 * actions in one ⋯ menu (Create vault, Rename, Export, Open folder, Delete).
 * Open folder opens the folder the zip is in: the Files app would open the
 * zip itself in a viewer.
 */
function BackupRow({
  entry,
  locale,
  checked,
  selectionDisabled,
  exporting,
  folderReachable,
  exportPanel,
  onToggleSelected,
  onExport,
  onDelete,
  onCreateVaultFromBackup,
  onPromoteToSave,
  renameOpen,
  busy,
  onRenameStart,
  onRenameCancel,
  onRename,
}: BackupRowProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const { stacked, measure } = useRowButtonStack();
  const reveal = useRevealFolder();
  const title = entry.name || entry.fileName;
  const folder = folderReachable
    ? reveal.locate(entry.path.slice(0, entry.path.lastIndexOf("/")))
    : null;
  const held = selectionDisabled || exporting;
  const titleStyle = entry.name
    ? [typography.body, { fontWeight: "500" as const }]
    : typography.mono;

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.surfaceContainerHigh,
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
              label={title}
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
                text={title}
                style={[titleStyle, styles.rowTitle]}
                onWidth={(width) => measure("textWidth", width)}
              />
              <Text
                style={[titleStyle, styles.rowTitle, { color: colors.onSurface }]}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {title}
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
          <DropdownPanel
            label={title}
            heading={title}
            align="right"
            minWidth={220}
            trigger={
              <IconButton
                label={t("action.row_options", { name: title })}
                icon="more-horizontal"
                size={18}
                tone="muted"
              />
            }
          >
            {onCreateVaultFromBackup ? (
              <MenuActionItem
                icon="add"
                label={t("action.create_vault_from_backup")}
                disabled={selectionDisabled}
                onPress={onCreateVaultFromBackup}
              />
            ) : null}
            <MenuActionItem
              icon="pencil"
              label={t("modal.backup.rename")}
              selected={renameOpen}
              disabled={held}
              onPress={renameOpen ? onRenameCancel : onRenameStart}
            />
            <MenuActionItem
              icon="download"
              label={t("modal.backup.export")}
              disabled={held}
              onPress={onExport}
            />
            {folder ? (
              <MenuActionItem
                icon="file-manager"
                label={t("action.open_folder")}
                onPress={() => reveal.open(folder)}
              />
            ) : null}
            <MenuActionItem
              icon="trash"
              label={t("action.delete")}
              danger
              disabled={held}
              onPress={onDelete}
            />
          </DropdownPanel>
        </View>
      </View>
      {reveal.toast}
      {renameOpen ? (
        <View style={styles.rowExport}>
          <BackupRenameEditor
            initial={entry.name}
            busy={busy}
            onSave={onRename}
            onCancel={onRenameCancel}
          />
        </View>
      ) : null}
      {exportPanel ? <View style={styles.rowExport}>{exportPanel}</View> : null}
    </View>
  );
}

/** A backup's name: naming it pins it, an empty name takes the name away. */
function BackupRenameEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const [name, setName] = useState(initial);
  const unchanged = normalizeBackupName(name) === initial;
  const tooLong = Array.from(name.trim()).length > BACKUP_NAME_MAX_CHARS;
  const canSave = !unchanged && !tooLong && !busy;
  return (
    <View style={styles.renameEditor}>
      <ThemedInput
        value={name}
        autoFocus
        accessibilityLabel={t("modal.backup.rename_label")}
        placeholder={t("modal.backup.rename_label")}
        onChangeText={setName}
        onSubmitEditing={() => {
          if (canSave) onSave(name);
        }}
      />
      <Text
        accessibilityRole={tooLong ? "alert" : "text"}
        style={[typography.caption, tooLong ? { color: colors.onErrorContainer } : null]}
      >
        {t("modal.backup.rename_hint", { max: String(BACKUP_NAME_MAX_CHARS) })}
      </Text>
      <ModalFooterActions layout="dialog">
        <Button label={t("action.cancel")} variant="ghost" size="sm" onPress={onCancel} />
        <Button
          label={t("modal.backup.rename_save")}
          variant="secondary"
          size="sm"
          disabled={!canSave}
          onPress={() => onSave(name)}
        />
      </ModalFooterActions>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: spacing.md },
  saveRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  saveStatus: { flex: 1, minWidth: 0 },
  saveRunning: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  list: { gap: spacing.md },
  empty: { textAlign: "center", paddingVertical: 40, fontSize: 14 },
  footer: { gap: spacing.sm },
  selectionBar: {
    minHeight: 48,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: spacing.xs,
  },
  selectedCount: { flex: 1, minWidth: 0 },
  selectionActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  listExport: {
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  folderRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  folderPath: { flex: 1, minWidth: 0, fontSize: 11 },
  folderProblem: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  notInUse: { opacity: 0.75 },
  renameEditor: { gap: spacing.sm },
  tier: { gap: spacing.sm },
  sectionHelp: { marginTop: 2, lineHeight: 18 },
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
