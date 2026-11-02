import { Animated, Text } from "react-native";
import type { VaultDisplayStatus } from "@upriv/shared";
import { isVaultPipelineDisplayBusy, vaultStatusI18nKey } from "@upriv/shared";
import { usePulseOpacity } from "@/hooks/usePulseOpacity";
import { useTranslation, type I18nKey } from "@/i18n";
import { useTheme } from "@/theme";
import { radii } from "@/theme/tokens";
import { vaultStatusBadgeColors } from "@/theme/vault-status";

interface VaultStatusBadgeProps {
  status: VaultDisplayStatus;
  /** Overrides the status label (e.g. a closing vault in its backup phase). */
  labelKey?: I18nKey;
}

/** Uppercase mono chip — desktop `VaultStatusBadge`. Work in flight pulses. */
export function VaultStatusBadge({ status, labelKey }: VaultStatusBadgeProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const tone = vaultStatusBadgeColors(status, colors);
  const pulse = usePulseOpacity(isVaultPipelineDisplayBusy(status));

  return (
    <Animated.View
      style={{
        alignSelf: "flex-start",
        backgroundColor: tone.background,
        borderRadius: radii.xs,
        paddingHorizontal: 8,
        paddingVertical: 2,
        flexShrink: 0,
        opacity: pulse,
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
        {t(labelKey ?? (vaultStatusI18nKey[status] as I18nKey)).toLocaleUpperCase()}
      </Text>
    </Animated.View>
  );
}
