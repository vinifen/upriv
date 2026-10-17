import { View } from "react-native";
import { storageModeIsPlaintext, type StorageMode } from "@upriv/shared";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";

interface VaultPlaintextIndicatorProps {
  storageMode: StorageMode;
  size?: number;
}

/** Stays beside the name while this vault stores files as plaintext while open. */
export function VaultPlaintextIndicator({ storageMode, size = 14 }: VaultPlaintextIndicatorProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  if (!storageModeIsPlaintext(storageMode)) return null;

  const label = t("vault.plaintext.badge");

  return (
    <View accessibilityLabel={label} accessibilityRole="image">
      <Icon name="plaintext" size={size} color={colors.onErrorContainer} />
    </View>
  );
}
