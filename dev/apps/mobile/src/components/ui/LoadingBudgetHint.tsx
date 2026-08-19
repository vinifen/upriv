import { Text, StyleSheet } from "react-native";
import {
  formatLoadingRemaining,
  loadingBudgetMinutes,
  loadingBudgetSeconds,
  loadingBudgetUsesMinutes,
} from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";

interface LoadingBudgetHintProps {
  budgetMs: number;
  remainingMs: number;
}

/** Shows max duration + countdown so long loads never look infinite. */
export function LoadingBudgetHint({ budgetMs, remainingMs }: LoadingBudgetHintProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  const remaining = formatLoadingRemaining(remainingMs);
  const text = loadingBudgetUsesMinutes(budgetMs)
    ? t("loading.budget_hint", {
        minutes: loadingBudgetMinutes(budgetMs),
        remaining,
      })
    : t("loading.budget_hint_seconds", {
        seconds: loadingBudgetSeconds(budgetMs),
        remaining,
      });

  return <Text style={[typography.caption, styles.text]}>{text}</Text>;
}

const styles = StyleSheet.create({
  text: { textAlign: "center", marginTop: spacing.sm },
});
