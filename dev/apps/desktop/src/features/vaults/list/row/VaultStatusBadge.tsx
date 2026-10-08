import { useTranslation, type I18nKey } from "@/i18n";
import type { VaultDisplayStatus } from "@upriv/shared";
import { vaultStatusBadgeClass, vaultStatusI18nKey } from "@/theme";

interface VaultStatusBadgeProps {
  status: VaultDisplayStatus;
  /** Overrides the status label (e.g. a closing vault in its backup phase). */
  labelKey?: I18nKey;
}

export function VaultStatusBadge({ status, labelKey }: VaultStatusBadgeProps) {
  const { t } = useTranslation();

  return (
    <span
      className={[
        "inline-flex shrink-0 rounded px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide",
        vaultStatusBadgeClass[status],
      ].join(" ")}
    >
      {t(labelKey ?? vaultStatusI18nKey[status])}
    </span>
  );
}
