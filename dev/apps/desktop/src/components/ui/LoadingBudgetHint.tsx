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
  /** `inline` — vault row meta; default block margin for dialogs. */
  layout?: "block" | "inline";
}

/** Shows max duration + countdown so long loads never look infinite. */
export function LoadingBudgetHint({
  budgetMs,
  remainingMs,
  layout = "block",
}: LoadingBudgetHintProps) {
  const { t } = useTranslation();
  const remaining = formatLoadingRemaining(remainingMs);
  const className =
    layout === "inline"
      ? "min-w-0 truncate text-xs leading-snug text-on-surface-variant"
      : "mt-3 text-xs leading-relaxed text-on-surface-variant/90";
  const copy = loadingBudgetUsesMinutes(budgetMs)
    ? t("loading.budget_hint", {
        minutes: loadingBudgetMinutes(budgetMs),
        remaining,
      })
    : t("loading.budget_hint_seconds", {
        seconds: loadingBudgetSeconds(budgetMs),
        remaining,
      });
  return (
    <p className={className} role="status">
      {copy}
    </p>
  );
}
