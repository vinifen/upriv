import { Modal as RnModal, StyleSheet, Text, View } from "react-native";
import { LOADING_BUDGET_MS, type VaultListItem } from "@upriv/shared";
import { useLoadingBudget } from "@upriv/shared/react";
import { useTranslation, type I18nKey } from "@/i18n";
import { Button, LoadingBudgetHint } from "@/components/ui";
import { useTheme } from "@/theme";
import { radii, spacing } from "@/theme/tokens";

interface VaultPipelineOverlayProps {
  vault: VaultListItem | null;
  open: boolean;
  title: string;
  hint: string;
  stepKeys: readonly I18nKey[];
  activeStep: number;
  errorKey?: I18nKey | null;
  onBackground: () => void;
  onDismissError?: () => void;
}

export function VaultPipelineOverlay({
  vault,
  open,
  title,
  hint,
  stepKeys,
  activeStep,
  errorKey = null,
  onBackground,
  onDismissError,
}: VaultPipelineOverlayProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const failed = errorKey !== null;
  const budget = useLoadingBudget(open && !failed, LOADING_BUDGET_MS.vaultPipeline);

  if (!open || !vault) return null;

  return (
    <RnModal visible={open} transparent animationType="fade" onRequestClose={onBackground}>
      <View style={[styles.scrim, { backgroundColor: colors.modalScrim }]}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceContainerHigh,
              borderColor: colors.outlineVariant,
            },
          ]}
        >
          <Text style={typography.headline}>{title}</Text>
          <Text style={typography.bodyMuted}>{hint}</Text>

          {failed ? (
            <>
              <Text style={[typography.body, { color: colors.onErrorContainer }]}>
                {t(errorKey!)}
              </Text>
              <Button
                label={t("action.close")}
                variant="accent"
                onPress={() => onDismissError?.()}
              />
            </>
          ) : (
            <>
              <View style={styles.steps}>
                {stepKeys.map((key, index) => {
                  const done = index < activeStep;
                  const current = index === activeStep;
                  return (
                    <Text
                      key={key}
                      style={[
                        typography.body,
                        { color: colors.onSurfaceVariant },
                        done ? { color: colors.vaultStatusOpen } : null,
                        current ? { color: colors.onSurface, fontWeight: "600" } : null,
                      ]}
                    >
                      {done ? "✓ " : current ? "… " : "○ "}
                      {t(key)}
                    </Text>
                  );
                })}
              </View>
              {budget.visible ? (
                <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
              ) : null}
              <Button
                label={t("pipeline.action.background")}
                variant="ghost"
                onPress={onBackground}
              />
            </>
          )}
        </View>
      </View>
    </RnModal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.xl,
    gap: spacing.md,
  },
  steps: { gap: spacing.sm, marginVertical: spacing.sm },
});
