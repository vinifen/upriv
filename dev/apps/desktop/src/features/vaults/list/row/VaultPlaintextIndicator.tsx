import { storageModeIsPlaintext, type StorageMode } from "@upriv/shared";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";

interface VaultPlaintextIndicatorProps {
  storageMode: StorageMode;
  size?: number;
  className?: string;
}

/** Stays beside the name while this vault stores files as plaintext while open. */
export function VaultPlaintextIndicator({
  storageMode,
  size = 14,
  className = "",
}: VaultPlaintextIndicatorProps) {
  const { t } = useTranslation();
  if (!storageModeIsPlaintext(storageMode)) return null;

  const label = t("vault.plaintext.badge");

  return (
    <span title={label} aria-label={label} role="img" className="inline-flex shrink-0">
      <Icon
        name="plaintext"
        size={size}
        className={["text-on-error-container", className].filter(Boolean).join(" ")}
      />
    </span>
  );
}
