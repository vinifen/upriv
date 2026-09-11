import { View } from "react-native";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";

interface VaultLastOpenedIndicatorProps {
  active?: boolean;
  size?: number;
}

/** Marks the vault id stored in `[app].last_opened_vault` (global pointer). */
export function VaultLastOpenedIndicator({
  active = false,
  size = 14,
}: VaultLastOpenedIndicatorProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  if (!active) return null;
  const label = t("vault.last_opened.badge");
  return (
    <View accessibilityLabel={label} accessibilityRole="image">
      <Icon name="history" size={size} color={colors.accent} />
    </View>
  );
}
