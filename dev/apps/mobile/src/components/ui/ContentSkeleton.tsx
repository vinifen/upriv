import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme";
import { colorAlpha, spacing } from "@/theme/tokens";

const ROW_WIDTHS = ["92%", "68%", "80%", "52%", "74%"] as const;

/**
 * Modal body while a short read is in flight.
 * The budget countdown stays delayed; this fills the panel immediately.
 */
export function ContentSkeleton({ label }: { label: string }) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;
  const fill = { backgroundColor: colorAlpha(colors.onSurfaceVariant, 0.22) };

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    const step = (toValue: number) =>
      Animated.timing(pulse, {
        toValue,
        duration: 1000,
        easing: Easing.bezier(0.4, 0, 0.6, 1),
        useNativeDriver: true,
      });
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled || reduce) return;
      loop = Animated.loop(Animated.sequence([step(0.5), step(1)]));
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [pulse]);

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
