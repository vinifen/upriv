import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme/ThemeContext";
import { modalShadow, radii, spacing } from "@/theme/tokens";

interface ToastProps {
  message: string | null;
  onDismiss: () => void;
  /** Extra lift above the default safe-area offset (file-manager dock). */
  bottomExtra?: number;
}

/** Bottom toast — desktop `Toast` parity (message + close). */
export function Toast({ message, onDismiss, bottomExtra = 0 }: ToastProps) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  if (!message) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { bottom: Math.max(insets.bottom, spacing.md) + spacing.md + bottomExtra },
      ]}
    >
      <View
        style={[
          styles.toast,
          modalShadow,
          {
            backgroundColor: colors.surfaceContainerHigh,
            borderColor: colors.outlineVariant,
          },
        ]}
        accessibilityRole="alert"
      >
        <Text style={[typography.body, styles.text, { color: colors.onSurface }]}>{message}</Text>
        <Pressable
          onPress={onDismiss}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("action.close")}
          style={styles.close}
        >
          <Icon name="close" size={16} color={colors.onSurfaceVariant} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 300,
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: spacing.md,
    maxWidth: 448,
    width: "100%",
  },
  text: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    lineHeight: 20,
  },
  close: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
});
