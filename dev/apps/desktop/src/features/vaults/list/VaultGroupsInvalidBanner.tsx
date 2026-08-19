import { Button, LoadingBudgetHint } from "@/components/ui";
import { useTranslation } from "@/i18n";

interface VaultGroupsInvalidBannerProps {
  visible: boolean;
  busy?: boolean;
  budget?: { visible: boolean; budgetMs: number; remainingMs: number };
  onRepair: () => void;
  onDismiss: () => void;
}

export function VaultGroupsInvalidBanner({
  visible,
  busy = false,
  budget,
  onRepair,
  onDismiss,
}: VaultGroupsInvalidBannerProps) {
  const { t } = useTranslation();
  if (!visible) return null;

  return (
    <div
      className="mb-4 flex flex-col gap-3 rounded-xl border border-error-container/40 bg-error-container/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      role="alert"
    >
      <div className="space-y-1">
        <p className="text-sm text-on-surface">{t("vault.group.invalid_banner")}</p>
        {busy && budget?.visible ? (
          <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
        ) : null}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={onDismiss}>
          {t("vault.group.dismiss")}
        </Button>
        <Button variant="primary" size="sm" disabled={busy} onClick={onRepair}>
          {t("vault.group.repair")}
        </Button>
      </div>
    </div>
  );
}
