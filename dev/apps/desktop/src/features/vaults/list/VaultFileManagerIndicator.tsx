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

  const label =
    entry.surface === "maximized"
      ? t("vault.file_manager.active")
      : t("vault.file_manager.active_minimized");

  return (
    <span title={label} aria-label={label} role="img" className="inline-flex shrink-0">
      <Icon
        name="folder"
        size={size}
        className={["text-accent", className].filter(Boolean).join(" ")}
      />
    </span>
  );
}
