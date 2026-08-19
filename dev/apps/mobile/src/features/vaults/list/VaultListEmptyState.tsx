import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import { Button } from "@/components/ui";

interface VaultListEmptyStateProps {
  allVaultsHidden?: boolean;
  onCreateFromScratch: () => void;
  onImportArchive: () => void;
}

/** Empty vault list — create / import CTAs (desktop `VaultListEmptyState` parity). */
export function VaultListEmptyState({
  allVaultsHidden = false,
  onCreateFromScratch,
  onImportArchive,
}: VaultListEmptyStateProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();

  if (allVaultsHidden) {
    return (
      <View style={styles.wrap}>
        <Text style={[typography.bodyMuted, styles.center]}>{t("empty.vaults_all_hidden")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={[typography.caption, styles.center, styles.kicker]}>{t("empty.no_vaults")}</Text>
      <Text style={[typography.bodyMuted, styles.center]}>{t("empty.no_vaults_hint")}</Text>
      <View style={styles.actions}>
        <Button
          variant="primary"
          icon="add"
          label={t("empty.action.create_vault")}
          onPress={onCreateFromScratch}
        />
        <Button
          variant="ghost"
          icon="archive"
          label={t("empty.action.import_archive")}
          onPress={onImportArchive}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    alignItems: "center",
  },
  center: { textAlign: "center" },
  kicker: { textTransform: "uppercase", letterSpacing: 1.2 },
  actions: { width: "100%", maxWidth: 360, gap: spacing.sm, marginTop: spacing.sm },
});
