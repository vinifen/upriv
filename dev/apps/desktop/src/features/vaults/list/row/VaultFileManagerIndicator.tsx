import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { fileManagerIndicator } from "@upriv/shared";
import { useFileManagerSelector } from "@upriv/shared/react";

interface VaultFileManagerIndicatorProps {
  vaultId: string;
  size?: number;
  className?: string;
}

export function VaultFileManagerIndicator({
  vaultId,
  size = 14,
  className = "",
}: VaultFileManagerIndicatorProps) {
  const { t } = useTranslation();
  const indicator = useFileManagerSelector((state) => fileManagerIndicator(state, vaultId));
  if (!indicator) return null;

  const importing = indicator === "importing";
  const label = importing
    ? t("vault.file_manager.importing")
    : indicator === "maximized"
      ? t("vault.file_manager.active")
      : t("vault.file_manager.active_minimized");

  return (
    <span title={label} aria-label={label} role="img" className="inline-flex shrink-0">
      {importing ? (
        <span
          className={[
            "inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent/30 border-t-accent",
            className,
          ]
            .filter(Boolean)
            .join(" ")}
        />
      ) : (
        <Icon
          name="folder"
          size={size}
          className={["text-accent", className].filter(Boolean).join(" ")}
        />
      )}
    </span>
  );
}
