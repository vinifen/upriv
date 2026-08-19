import type { ReactNode } from "react";
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/components/icons";
import { useTheme } from "@/theme";
import { radii, spacing } from "@/theme/tokens";

interface IconButtonProps {
  /** Accessibility label (desktop `aria-label` / title). */
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  /** Named glyph — ignored when `children` is provided. */
  icon?: IconName;
  size?: number;
  tone?: "default" | "muted" | "accent";
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Icon-only control — desktop `IconButton` parity. */
export function IconButton({
  label,
  onPress,
  disabled,
  icon,
  size = 22,
  tone = "muted",
  children,
  style,
}: IconButtonProps) {
  const { colors } = useTheme();
  const color =
    tone === "accent"
      ? colors.accent
      : tone === "default"
        ? colors.onSurface
        : colors.onSurfaceVariant;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.base, { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }, style]}
    >
      {children ?? (icon ? <Icon name={icon} size={size} color={color} /> : null)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minWidth: 40,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
    padding: spacing.xs,
  },
});
