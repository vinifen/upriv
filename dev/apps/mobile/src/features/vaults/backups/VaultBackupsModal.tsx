import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatBackupDate, type VaultBackupEntry, type VaultListItem } from "@upriv/shared";
import { useBackupService } from "@/platform/services";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { Button, Modal } from "@/components/ui";
import { useTheme } from "@/theme";
import { radii, spacing } from "@/theme/tokens";

interface VaultBackupsModalProps {
  vault: VaultListItem | null;
  open: boolean;
  onClose: () => void;
  showToast: (message: string) => void;
}

export function VaultBackupsModal({ vault, open, onClose, showToast }: VaultBackupsModalProps) {
  const { t, locale } = useTranslation();
  const { colors, typography } = useTheme();
  const backups = useBackupService();
  const [entries, setEntries] = useState<VaultBackupEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!vault) return;
    setLoading(true);
    setError(null);
    try {
      const list = await backups.listBackups(vault.id);
      setEntries(list);
      setSelected(new Set());
    } catch (caught) {
      setError(t(mobileErrorI18nKey(caught, "modal.backup.load_failed")));
    } finally {
      setLoading(false);
    }
  }, [backups, t, vault]);

  useEffect(() => {
    if (!open || !vault) {
      setEntries([]);
      setSelected(new Set());
      setError(null);
      return;
    }
    void reload();
  }, [open, reload, vault]);

  const toggle = (filename: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const deleteSelected = async () => {
    if (!vault || selected.size === 0) return;
    await backups.deleteBackups(vault.id, [...selected]);
    showToast(t("modal.backup.delete_selected"));
    await reload();
  };

  const promote = async (filename: string) => {
    if (!vault) return;
    await backups.promoteToSave(vault.id, filename);
    showToast(t("modal.backup.promote_to_save"));
    await reload();
  };

  if (!open || !vault) return null;

  const saves = entries.filter((e) => e.saved);
  const standard = entries.filter((e) => !e.saved);

  return (
    <Modal
      open={open}
      title={t("modal.backup.title", { name: vault.displayName })}
      onClose={onClose}
      panelClassName="max-w-2xl"
      footer={
        <View style={styles.actions}>
          <Button label={t("action.close")} variant="ghost" onPress={onClose} />
          <Button
            label={t("modal.backup.delete_selected")}
            variant="danger"
            disabled={selected.size === 0}
            onPress={() => void deleteSelected()}
          />
        </View>
      }
    >
      <View style={styles.content}>
        <Text style={typography.caption}>{t("modal.backup.hint")}</Text>
        {loading ? <Text style={typography.bodyMuted}>{t("modal.backup.loading")}</Text> : null}
        {error ? (
          <Text style={[typography.body, { color: colors.onErrorContainer }]}>{error}</Text>
        ) : null}
        {!loading && !error && entries.length === 0 ? (
          <Text style={typography.bodyMuted}>{t("modal.backup.empty")}</Text>
        ) : null}

        {saves.length > 0 ? (
          <>
            <Text style={[typography.headline, { marginTop: spacing.sm }]}>
              {t("modal.backup.section.saves")}
            </Text>
            {saves.map((entry) => (
              <BackupRow
                key={entry.filename}
                entry={entry}
                selected={selected.has(entry.filename)}
                onToggle={() => toggle(entry.filename)}
                locale={locale}
              />
            ))}
          </>
        ) : null}

        {standard.length > 0 ? (
          <>
            <Text style={[typography.headline, { marginTop: spacing.sm }]}>
              {t("modal.backup.section.standard")}
            </Text>
            {standard.map((entry) => (
              <View key={entry.filename} style={styles.rowBlock}>
                <BackupRow
                  entry={entry}
                  selected={selected.has(entry.filename)}
                  onToggle={() => toggle(entry.filename)}
                  locale={locale}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  label={t("modal.backup.promote_to_save")}
                  onPress={() => void promote(entry.filename)}
                />
              </View>
            ))}
          </>
        ) : null}
      </View>
    </Modal>
  );
}

function BackupRow({
  entry,
  selected,
  onToggle,
  locale,
}: {
  entry: VaultBackupEntry;
  selected: boolean;
  onToggle: () => void;
  locale: string;
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      style={[
        styles.row,
        {
          backgroundColor: colors.surfaceContainerHigh,
          borderColor: selected ? colors.accent : colors.outlineVariant,
        },
      ]}
    >
      <Text style={[typography.body, { fontWeight: "600" }]} numberOfLines={1}>
        {entry.filename}
      </Text>
      <Text style={typography.caption}>
        {formatBackupDate(entry.createdAt, locale)}
        {entry.saved ? ` · ${t("modal.backup.saved_badge")}` : ""}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm },
  rowBlock: { gap: spacing.xs },
  row: {
    borderRadius: radii.sm,
    borderWidth: 1,
    padding: spacing.md,
    gap: 4,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "flex-end",
    marginTop: spacing.md,
  },
});
