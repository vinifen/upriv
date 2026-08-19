import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { MAX_WIDTH_CONTENT } from "@/theme/tokens";

interface CenteredPanelProps {
  children: ReactNode;
  /** Desktop default `max-w-content` (1200); vault list uses `max-w-vault-list` (900). */
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Horizontally centered content column — desktop `CenteredPanel` parity (SDD §8.2).
 * Full-bleed backgrounds stay on the parent; only the column is capped.
 */
export function CenteredPanel({
  children,
  maxWidth = MAX_WIDTH_CONTENT,
  style,
}: CenteredPanelProps) {
  return <View style={[styles.column, { maxWidth }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  column: {
    flex: 1,
    width: "100%",
    alignSelf: "center",
  },
});
