import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/ThemeContext";
import { radii, spacing } from "@/theme/tokens";

interface ToastProps {
  message: string | null;
  onDismiss: () => void;
}

export function Toast({ message, onDismiss }: ToastProps) {
  const insets = useSafeAreaInsets();
  const { colors, typography } = useTheme();
  if (!message) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + spacing.md }]}>
      <Pressable
        onPress={onDismiss}
        style={[
          styles.toast,
          {
            backgroundColor: colors.surfaceContainerHighest,
            borderColor: colors.outlineVariant,
          },
        ]}
        accessibilityRole="alert"
      >
        <Text style={[typography.body, styles.text]}>{message}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 300,
    alignItems: "center",
  },
  toast: {
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    maxWidth: 480,
    width: "100%",
  },
  text: { textAlign: "center" },
});
