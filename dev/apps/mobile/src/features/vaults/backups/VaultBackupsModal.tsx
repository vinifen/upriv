import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  formatBackupDate,
  formatBytes,
  type VaultBackupEntry,
  type VaultListItem,
} from "@upriv/shared";
import { useBackupService } from "@/platform/services";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { Button, Checkbox, IconButton, Modal, ModalFooterActions, Toast } from "@/components/ui";
import { ThemedInput } from "@/components/settings";
import { Icon } from "@/components/icons";
import { useTheme } from "@/theme";
import { colorAlpha, radii, spacing } from "@/theme/tokens";
import { useToast } from "@upriv/shared/react";
import { useVaultBackups } from "@upriv/shared/react";
import { shareBackupsZip } from "./shareBackupsZip";

interface VaultBackupsModalProps {
  vault: VaultListItem | null;
  open: boolean;
  onClose: () => void;
  onCreateVaultFromBackup?: (stamp: string) => void;
  /** List-level toast so a download can finish after this modal closes. */
  onDownloadNotice?: (message: string) => void;
}

function matchesDeleteConfirmation(input: string, count: number, vaultId: string): boolean {
  const trimmed = input.trim();
  if (count === 1) return trimmed === vaultId;
  return trimmed.toLowerCase() === `delete ${count}`;
}

export function VaultBackupsModal({
  vault,
  open,
  onClose,
  onCreateVaultFromBackup,
  onDownloadNotice,
}: VaultBackupsModalProps) {
  const { locale, t } = useTranslation();
  const { colors, typography } = useTheme();
  const { message: toastMessage, show: showToast, dismiss: dismissToast } = useToast();
  const backupService = useBackupService();
  const vaultId = vault?.id ?? null;
  const { backups, deleteBackups, promoteToSave, isLoading, isBusy, error } = useVaultBackups(
    backupService,
    vaultId,
    open,
  );

  const savedBackups = useMemo(() => backups.filter((entry) => entry.saved), [backups]);
  const standardBackups = useMemo(() => backups.filter((entry) => !entry.saved), [backups]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const allStamps = useMemo(() => backups.map((entry) => entry.stamp), [backups]);
  const allSelected = backups.length > 0 && allStamps.every((stamp) => selected.has(stamp));
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
      for (const stamp of current) {
        if (allStamps.includes(stamp)) next.add(stamp);
      }
      return next;
    });
    setDeleteTargets(null);
    setConfirmText("");
  }, [allStamps]);

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
    setSelected(new Set(allStamps));
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
    void promoteToSave(stamp).catch((err) => {
      showToast(t(mobileErrorI18nKey(err, "toast.backup_promote_failed")));
    });
  };

  const handleDownload = () => {
    const targets = someSelected ? backups.filter((entry) => selected.has(entry.stamp)) : backups;
    startDownload(targets);
  };

  const handleDownloadOne = (stamp: string) => {
    const entry = backups.find((item) => item.stamp === stamp);
    if (!entry) return;
    startDownload([entry]);
  };

  const startDownload = (targets: VaultBackupEntry[]) => {
    if (!vault || targets.length === 0) return;
    const vaultId = vault.id;
    const notice = onDownloadNotice ?? showToast;
    notice(t("toast.backup_download_started"));
    void shareBackupsZip(targets, t("modal.backup.download_zip_name", { id: vaultId }), {
      exportSnapshotsToPath: (stamps, destPath) =>
        backupService.exportSnapshotsToPath(vaultId, stamps, destPath),
    })
      .then(() => {
        notice(t("toast.backup_download_saved"));
      })
      .catch((err) => {
        notice(t(mobileErrorI18nKey(err, "toast.backup_download_failed")));
      });
  };

  return (
    <Modal
      open={open}
      title={t("modal.backup.title")}
      titleIcon="archive"
      contextTitle={vault.displayName}
      onClose={handleClose}
      panelClassName="max-w-2xl"
      overlay={<Toast message={toastMessage} onDismiss={dismissToast} />}
    >
      <Text style={[typography.bodyMuted, styles.hint]}>{t("modal.backup.hint")}</Text>

      {isLoading ? (
        <Text style={[typography.mono, styles.empty]}>{t("modal.backup.loading")}</Text>
      ) : error ? (
        <Text style={[styles.empty, { color: colors.onErrorContainer }]}>
          {t(mobileErrorI18nKey(error, "modal.backup.load_failed"))}
        </Text>
      ) : backups.length === 0 ? (
        <Text style={[typography.mono, styles.empty]}>{t("modal.backup.empty")}</Text>
      ) : (
        <View style={styles.list}>
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

          <BackupSection
            title={t("modal.backup.section.saves")}
            help={t("modal.backup.section.saves_help")}
            emptyLabel={t("modal.backup.saves_empty")}
            entries={savedBackups}
            locale={locale}
            selected={selected}
            selectionDisabled={deleteTargets !== null}
            onToggleSelected={toggleSelected}
            onDownload={handleDownloadOne}
            onDelete={(stamp) => beginDelete([stamp])}
            onCreateVaultFromBackup={onCreateVaultFromBackup}
          />
          <BackupSection
            title={t("modal.backup.section.standard")}
            help={t("modal.backup.section.standard_help")}
            emptyLabel={t("modal.backup.standard_empty")}
            entries={standardBackups}
            locale={locale}
            selected={selected}
            selectionDisabled={deleteTargets !== null}
            onToggleSelected={toggleSelected}
            onDownload={handleDownloadOne}
            onDelete={(stamp) => beginDelete([stamp])}
            onCreateVaultFromBackup={onCreateVaultFromBackup}
            onPromoteToSave={handlePromoteToSave}
          />
        </View>
      )}

      {deleteTargets !== null ? (
        <View
          style={[
            styles.confirmCard,
            {
              backgroundColor: colors.surfaceContainer,
              borderColor: colorAlpha(colors.outlineVariant, 0.2),
            },
          ]}
        >
          <Text style={typography.bodyMuted}>
            {isSingleDelete
              ? t("modal.backup.delete_confirm_one")
              : t("modal.backup.delete_confirm_many", { count: String(deleteCount) })}
          </Text>
          <Text style={[typography.mono, styles.confirmPhrase]}>
            {isSingleDelete
              ? vault.id
              : t("modal.backup.delete_phrase_many", { count: String(deleteCount) })}
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
  emptyLabel: string;
  entries: VaultBackupEntry[];
  locale: string;
  selected: Set<string>;
  selectionDisabled: boolean;
  onToggleSelected: (stamp: string) => void;
  onDownload: (stamp: string) => void;
  onDelete: (stamp: string) => void;
  onCreateVaultFromBackup?: (stamp: string) => void;
  onPromoteToSave?: (stamp: string) => void;
}

function BackupSection({
  title,
  help,
  emptyLabel,
  entries,
  locale,
  selected,
  selectionDisabled,
  onToggleSelected,
  onDownload,
  onDelete,
  onCreateVaultFromBackup,
  onPromoteToSave,
}: BackupSectionProps) {
  const { colors, typography } = useTheme();
  return (
    <View style={styles.section}>
      <View>
        <Text style={[typography.body, { fontWeight: "500" }]}>{title}</Text>
        <Text style={[typography.caption, styles.sectionHelp]}>{help}</Text>
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
          {entries.map((entry) => (
            <BackupRow
              key={entry.stamp}
              entry={entry}
              locale={locale}
              checked={selected.has(entry.stamp)}
              selectionDisabled={selectionDisabled}
              onToggleSelected={() => onToggleSelected(entry.stamp)}
              onDownload={() => onDownload(entry.stamp)}
              onDelete={() => onDelete(entry.stamp)}
              onCreateVaultFromBackup={
                onCreateVaultFromBackup ? () => onCreateVaultFromBackup(entry.stamp) : undefined
              }
              onPromoteToSave={onPromoteToSave ? () => onPromoteToSave(entry.stamp) : undefined}
            />
          ))}
        </View>
      )}
    </View>
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
      <View style={styles.toolbarActions}>
        {someSelected ? (
          <Text style={[typography.caption, styles.selectedCount]}>
            {t("modal.backup.selected_count", { count: String(selectedCount) })}
          </Text>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          label={
            someSelected ? t("modal.backup.download_selected") : t("modal.backup.download_all")
          }
          onPress={onDownload}
        />
        {someSelected ? (
          <IconButton
            label={t("modal.backup.delete_selected")}
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

interface BackupRowProps {
  entry: VaultBackupEntry;
  locale: string;
  checked: boolean;
  selectionDisabled: boolean;
  onToggleSelected: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onCreateVaultFromBackup?: () => void;
  onPromoteToSave?: () => void;
}

function BackupRow({
  entry,
  locale,
  checked,
  selectionDisabled,
  onToggleSelected,
  onDownload,
  onDelete,
  onCreateVaultFromBackup,
  onPromoteToSave,
}: BackupRowProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.surfaceContainer,
          borderColor: checked ? colorAlpha(colors.accent, 0.4) : "transparent",
          opacity: selectionDisabled ? 0.6 : 1,
        },
      ]}
      pointerEvents={selectionDisabled ? "none" : "auto"}
    >
      <Checkbox
        checked={checked}
        disabled={selectionDisabled}
        onChange={onToggleSelected}
        label={entry.stamp}
      />
      <View style={[styles.rowIcon, { backgroundColor: colors.surfaceContainerHighest }]}>
        <Icon name="archive" size={18} color={colors.onSurfaceVariant} />
      </View>
      <Pressable style={styles.rowCopy} onPress={onToggleSelected} disabled={selectionDisabled}>
        <View style={styles.rowTitleRow}>
          <Text
            style={[typography.mono, styles.rowTitle, { color: colors.onSurface }]}
            numberOfLines={1}
          >
            {entry.stamp}
          </Text>
          {entry.saved ? (
            <View style={[styles.badge, { backgroundColor: colorAlpha(colors.accent, 0.15) }]}>
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
      <View style={styles.rowActions}>
        {onPromoteToSave ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={selectionDisabled}
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
          label={t("action.download")}
          icon="download"
          size={18}
          tone="muted"
          disabled={selectionDisabled}
          onPress={onDownload}
        />
        <IconButton
          label={t("action.delete")}
          icon="trash"
          size={18}
          tone="muted"
          disabled={selectionDisabled}
          onPress={onDelete}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: spacing.md },
  list: { gap: spacing.xl },
  empty: { textAlign: "center", paddingVertical: 40, fontSize: 14 },
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
  section: { gap: spacing.sm },
  sectionHelp: { marginTop: 2, lineHeight: 18 },
  sectionEmpty: {
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    textAlign: "center",
  },
  sectionList: { gap: spacing.sm },
  row: {
    minHeight: 56,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rowCopy: { flex: 1, minWidth: 80, gap: 2 },
  rowTitleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  rowTitle: { flexShrink: 1 },
  badge: {
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
    gap: 2,
    marginLeft: "auto",
  },
  confirmCard: {
    marginTop: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  confirmPhrase: { opacity: 0.8 },
});
