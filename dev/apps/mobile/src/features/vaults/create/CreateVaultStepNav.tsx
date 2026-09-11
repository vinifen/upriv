import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  CREATE_VAULT_STEPS,
  type CreateVaultStepId,
  type CreateVaultStepStatus,
} from "@upriv/shared";
import { useTranslation, type I18nKey } from "@/i18n";
import { useTheme } from "@/theme";
import { radii, spacing } from "@/theme/tokens";

interface CreateVaultStepNavProps {
  currentStep: CreateVaultStepId;
  stepStatuses: Record<CreateVaultStepId, CreateVaultStepStatus>;
  onSelectStep: (step: CreateVaultStepId) => void;
}

/** Numbered step strip — desktop `CreateVaultStepNav` parity. */
export function CreateVaultStepNav({
  currentStep,
  stepStatuses,
  onSelectStep,
}: CreateVaultStepNavProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();

  return (
    <View
      style={styles.wrap}
      accessibilityRole="toolbar"
      accessibilityLabel={t("vault.create.step_nav")}
    >
      {/* Horizontal only — parent create wizard owns the vertical scroll pane below. */}
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        contentContainerStyle={styles.row}
        style={styles.scroll}
      >
        {CREATE_VAULT_STEPS.map((stepId, index) => {
          const status = stepStatuses[stepId];
          const isCurrent = currentStep === stepId;
          const statusColor =
            status === "ready"
              ? colors.vaultStatusOpen
              : status === "error"
                ? colors.onErrorContainer
                : colors.onSurfaceVariant;
          const badgeBg =
            status === "ready"
              ? colors.vaultStatusOpen + "26"
              : status === "error"
                ? colors.errorContainer + "40"
                : colors.surfaceContainerHighest;

          return (
            <Pressable
              key={stepId}
              onPress={() => onSelectStep(stepId)}
              style={[
                styles.step,
                {
                  borderColor: isCurrent ? colors.accent : colors.outlineVariant,
                  borderWidth: 2,
                  backgroundColor: isCurrent
                    ? colors.surfaceContainer
                    : colors.surfaceContainer + "80",
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: isCurrent }}
            >
              <View style={[styles.badge, { backgroundColor: badgeBg }]}>
                <Text style={[typography.caption, { color: statusColor, fontWeight: "700" }]}>
                  {index + 1}
                </Text>
              </View>
              <View style={styles.labels}>
                <Text
                  style={[typography.caption, { color: colors.onSurface, fontWeight: "600" }]}
                  numberOfLines={1}
                >
                  {t(`vault.create.step.${stepId}` as I18nKey)}
                </Text>
                <Text
                  style={[typography.caption, styles.status, { color: statusColor }]}
                  numberOfLines={1}
                >
                  {t(`vault.create.step_status.${status}` as I18nKey)}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.sm, flexShrink: 0 },
  scroll: { flexGrow: 0 },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  step: {
    width: 136,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
  },
  badge: {
    width: 24,
    height: 24,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
  },
  labels: { flex: 1, minWidth: 0, gap: 3 },
  status: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
});
