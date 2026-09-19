import { View } from "react-native";
import { Icon } from "@/components/icons";
import { useFileManager } from "@/features/vaults/file-manager";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";

interface VaultFileManagerIndicatorProps {
  vaultId: string;
  size?: number;
}

export function VaultFileManagerIndicator({ vaultId, size = 14 }: VaultFileManagerIndicatorProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { entries } = useFileManager();
  const entry = entries[vaultId];
  if (!entry) return null;

  const label =
    entry.surface === "maximized"
      ? t("vault.file_manager.active")
      : t("vault.file_manager.active_minimized");

  return (
    <View accessibilityRole="image" accessibilityLabel={label}>
      <Icon name="folder" size={size} color={colors.accent} />
    </View>
  );
}
