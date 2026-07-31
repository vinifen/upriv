import {
  formatLoadingRemaining,
  loadingBudgetMinutes,
  loadingBudgetSeconds,
  loadingBudgetUsesMinutes,
} from "@upriv/shared";
import { useTranslation } from "@/i18n";

interface LoadingBudgetHintProps {
  budgetMs: number;
  remainingMs: number;
}

/** Shows max duration + countdown so long loads never look infinite. */
export function LoadingBudgetHint({ budgetMs, remainingMs }: LoadingBudgetHintProps) {
  const { t } = useTranslation();
  const remaining = formatLoadingRemaining(remainingMs);
  if (loadingBudgetUsesMinutes(budgetMs)) {
    return (
      <p className="mt-3 text-xs leading-relaxed text-on-surface-variant/90" role="status">
        {t("loading.budget_hint", {
          minutes: loadingBudgetMinutes(budgetMs),
          remaining,
        })}
      </p>
    );
  }
  return (
    <p className="mt-3 text-xs leading-relaxed text-on-surface-variant/90" role="status">
      {t("loading.budget_hint_seconds", {
        seconds: loadingBudgetSeconds(budgetMs),
        remaining,
      })}
    </p>
  );
}
