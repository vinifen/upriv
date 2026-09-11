import { View } from "react-native";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";

interface VaultHiddenIndicatorProps {
  hidden?: boolean;
  size?: number;
  labelKey?: "vault.hidden.badge" | "vault.group.hidden.badge";
}

export function VaultHiddenIndicator({
  hidden = false,
  size = 14,
  labelKey = "vault.hidden.badge",
}: VaultHiddenIndicatorProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  if (!hidden) return null;
  const label = t(labelKey);
  return (
    <View accessibilityLabel={label} accessibilityRole="image">
      <Icon name="eye-off" size={size} color={colors.onSurfaceVariant} />
    </View>
  );
}
