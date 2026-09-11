import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";

interface VaultHiddenIndicatorProps {
  hidden?: boolean;
  size?: number;
  className?: string;
  labelKey?: "vault.hidden.badge" | "vault.group.hidden.badge";
}

export function VaultHiddenIndicator({
  hidden = false,
  size = 14,
  className = "",
  labelKey = "vault.hidden.badge",
}: VaultHiddenIndicatorProps) {
  const { t } = useTranslation();
  if (!hidden) return null;

  const label = t(labelKey);

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
