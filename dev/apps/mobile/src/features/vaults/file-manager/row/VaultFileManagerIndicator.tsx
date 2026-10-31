import { ActivityIndicator, View } from "react-native";
import { fileManagerIndicator } from "@upriv/shared";
import { useFileManagerSelector } from "@upriv/shared/react";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";

interface VaultFileManagerIndicatorProps {
  vaultId: string;
  size?: number;
}

export function VaultFileManagerIndicator({ vaultId, size = 14 }: VaultFileManagerIndicatorProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const indicator = useFileManagerSelector((state) => fileManagerIndicator(state, vaultId));
  if (!indicator) return null;

  const importing = indicator === "importing";
  const label = importing
    ? t("vault.file_manager.importing")
    : indicator === "maximized"
      ? t("vault.file_manager.active")
      : t("vault.file_manager.active_minimized");

  return (
    <View accessibilityRole="image" accessibilityLabel={label}>
      {importing ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : (
        <Icon name="folder" size={size} color={colors.accent} />
      )}
    </View>
  );
}
