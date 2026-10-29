import { Pressable, StyleSheet } from "react-native";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";

/** Path-bar button: toggles editor word wrap on/off. */
export function WordWrapToggle({
  wrap,
  onChange,
}: {
  wrap: boolean;
  onChange: (wrap: boolean) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(
        wrap
          ? "modal.file_manager.viewer.word_wrap_disable"
          : "modal.file_manager.viewer.word_wrap_enable",
      )}
      accessibilityState={{ selected: wrap }}
      hitSlop={6}
      onPress={() => onChange(!wrap)}
      style={({ pressed }) => [
        styles.toggle,
        {
          backgroundColor: wrap ? colors.surfaceContainerHighest : "transparent",
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Icon name="wrap-text" size={14} color={wrap ? colors.onSurface : colors.onSurfaceVariant} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toggle: {
    width: 24,
    height: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
});
