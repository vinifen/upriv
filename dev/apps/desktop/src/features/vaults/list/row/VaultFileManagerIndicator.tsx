import { Icon } from "@/components/icons";
import { useFileManager } from "@/features/vaults/file-manager";
import { useTranslation } from "@/i18n";

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
  const { entries } = useFileManager();
  const entry = entries[vaultId];
  if (!entry) return null;

  const importing = entry.importInFlight;
  const label = importing
    ? t("vault.file_manager.importing")
    : entry.surface === "maximized"
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
