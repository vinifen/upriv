import { Animated, StyleSheet, View } from "react-native";
import { usePulseOpacity } from "@/hooks/usePulseOpacity";
import { useTheme } from "@/theme";
import { colorAlpha, spacing } from "@/theme/tokens";

const ROW_WIDTHS = ["92%", "68%", "80%", "52%", "74%"] as const;

/**
 * Modal body while a short read is in flight.
 * The budget countdown stays delayed; this fills the panel immediately.
 */
export function ContentSkeleton({ label }: { label: string }) {
  const { colors } = useTheme();
  const pulse = usePulseOpacity();
  const fill = { backgroundColor: colorAlpha(colors.onSurfaceVariant, 0.22) };

  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.wrap}>
      {ROW_WIDTHS.map((width) => (
        <Animated.View key={width} style={[styles.bar, fill, { width, opacity: pulse }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md, paddingVertical: spacing.sm, minHeight: 160 },
  bar: { height: 12, borderRadius: 4 },
});
