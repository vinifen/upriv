import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";

interface VaultLastOpenedIndicatorProps {
  active?: boolean;
  size?: number;
  className?: string;
}

/** Marks the vault id stored in `[app].last_opened_vault` (global pointer). */
export function VaultLastOpenedIndicator({
  active = false,
  size = 14,
  className = "",
}: VaultLastOpenedIndicatorProps) {
  const { t } = useTranslation();
  if (!active) return null;

  const label = t("vault.last_opened.badge");

  return (
    <span title={label} aria-label={label} role="img" className="inline-flex shrink-0">
      <Icon
        name="history"
        size={size}
        className={["text-accent", className].filter(Boolean).join(" ")}
      />
    </span>
  );
}
