import { Pressable, Text, View } from "react-native";
import type { VaultDisplayStatus } from "@upriv/shared";
import { vaultStatusI18nKey } from "@upriv/shared";
import { Icon } from "@/components/icons";
import { useTranslation, type I18nKey } from "@/i18n";
import { useTheme } from "@/theme";
import { radii } from "@/theme/tokens";

const LOCK_WIDTH = 144;
const LOCK_HEIGHT = 44;
const LOCK_ICON_SIZE = 44;

interface VaultLockButtonProps {
  status: VaultDisplayStatus;
  layout?: "inline" | "block";
  /** Compact / small screens — lock / unlock glyph instead of the 9rem label. */
  appearance?: "label" | "icon";
  onLock?: () => void;
  onUnlock?: () => void;
}

/** Desktop `VaultLockButton` — label on wide rows, icon on compact chrome. */
export function VaultLockButton({
  status,
  layout = "inline",
  appearance = "label",
  onLock,
  onUnlock,
}: VaultLockButtonProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const isOpen = status === "open";
  const pipelineBusy = status === "closing" || status === "opening";
  const iconOnly = appearance === "icon" && layout !== "block";
  const label = pipelineBusy
    ? t(vaultStatusI18nKey[status] as I18nKey)
    : isOpen
      ? t("action.lock")
      : t("action.unlock");
  const backgroundColor = isOpen ? colors.surfaceContainerHigh : colors.surfaceContainerHighest;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: pipelineBusy, disabled: pipelineBusy }}
      disabled={pipelineBusy}
      onPress={() => {
        if (pipelineBusy) return;
        if (isOpen) onLock?.();
        else onUnlock?.();
      }}
      style={({ pressed }) => ({
        height: layout === "block" ? 40 : LOCK_HEIGHT,
        width: layout === "block" ? "100%" : iconOnly ? LOCK_ICON_SIZE : LOCK_WIDTH,
        borderRadius: radii.md,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor,
        opacity: pipelineBusy ? 0.7 : pressed ? 0.88 : 1,
      })}
    >
      {iconOnly ? (
        <Icon name={isOpen ? "lock" : "lock-open"} size={20} color={colors.onSurface} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%" }}>
          <Icon name={isOpen ? "lock" : "lock-open"} size={18} color={colors.onSurface} />
          <Text
            numberOfLines={1}
            style={{
              color: colors.onSurface,
              fontFamily: "monospace",
              fontSize: 14,
              fontWeight: "500",
              flexShrink: 1,
            }}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
