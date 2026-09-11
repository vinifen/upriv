import { Text, View } from "react-native";
import type { VaultDisplayStatus } from "@upriv/shared";
import { vaultStatusI18nKey } from "@upriv/shared";
import { useTranslation, type I18nKey } from "@/i18n";
import { useTheme } from "@/theme";
import { radii } from "@/theme/tokens";
import { vaultStatusBadgeColors } from "@/theme/vault-status";

interface VaultStatusBadgeProps {
  status: VaultDisplayStatus;
}

/** Uppercase mono chip — desktop `VaultStatusBadge`. */
export function VaultStatusBadge({ status }: VaultStatusBadgeProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const tone = vaultStatusBadgeColors(status, colors);

  return (
    <View
      style={{
        alignSelf: "flex-start",
        backgroundColor: tone.background,
        borderRadius: radii.xs,
        paddingHorizontal: 8,
        paddingVertical: 2,
        flexShrink: 0,
      }}
    >
      <Text
        style={{
          color: tone.foreground,
          fontFamily: "monospace",
          fontSize: 11,
          lineHeight: 16.5,
          fontWeight: "500",
          letterSpacing: 0.275,
          textTransform: "uppercase",
          includeFontPadding: false,
        }}
      >
        {t(vaultStatusI18nKey[status] as I18nKey).toLocaleUpperCase()}
      </Text>
    </View>
  );
}
