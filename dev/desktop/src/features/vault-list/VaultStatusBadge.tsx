import { useTranslation } from "@/i18n";
import type { VaultDisplayStatus } from "@upriv/shared";
import { vaultStatusBadgeClass, vaultStatusI18nKey } from "@/theme";

interface VaultStatusBadgeProps {
  status: VaultDisplayStatus;
}

export function VaultStatusBadge({ status }: VaultStatusBadgeProps) {
  const { t } = useTranslation();

  return (
    <span
      className={[
        "inline-flex shrink-0 rounded px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide",
        vaultStatusBadgeClass[status],
      ].join(" ")}
    >
      {t(vaultStatusI18nKey[status])}
    </span>
  );
}
