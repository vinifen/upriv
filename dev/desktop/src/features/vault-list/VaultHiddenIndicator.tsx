import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";

interface VaultHiddenIndicatorProps {
  hidden?: boolean;
  size?: number;
  className?: string;
}

export function VaultHiddenIndicator({ hidden = false, size = 14, className = "" }: VaultHiddenIndicatorProps) {
  const { t } = useTranslation();
  if (!hidden) return null;

  const label = t("vault.hidden.badge");

  return (
    <span title={label} aria-label={label} role="img" className="inline-flex shrink-0">
      <Icon
        name="eye-off"
        size={size}
        className={["text-on-surface-variant", className].filter(Boolean).join(" ")}
      />
    </span>
  );
}
