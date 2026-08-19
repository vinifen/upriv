import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Icon, type IconName } from "@/components/icons";
import { useTheme } from "@/theme/ThemeContext";
import { CONTROL_HEIGHT_MD, radii, spacing } from "@/theme/tokens";

type Variant = "primary" | "accent" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends Omit<PressableProps, "children"> {
  label: string;
  variant?: Variant;
  size?: Size;
  busy?: boolean;
  /** Leading icon — desktop Button+Icon parity (e.g. New vault). */
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  variant = "primary",
  size = "md",
  busy = false,
  icon,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const { colors } = useTheme();
  const isDisabled = Boolean(disabled || busy);
  const bg =
    variant === "primary"
      ? colors.primary
      : variant === "accent"
        ? colors.accent
        : variant === "danger"
          ? colors.errorContainer
          : "transparent";
  const labelColor =
    variant === "ghost"
      ? colors.onSurface
      : variant === "primary"
        ? colors.onPrimary
        : variant === "danger"
          ? colors.onErrorContainer
          : colors.accentForeground;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        size === "sm" ? styles.sm : styles.md,
        {
          backgroundColor: bg,
          borderWidth: variant === "ghost" ? 1 : 0,
          borderColor: colors.outlineVariant,
        },
        pressed && !isDisabled ? styles.pressed : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}
      {...rest}
    >
      {busy ? (
        <ActivityIndicator color={variant === "ghost" ? colors.accent : labelColor} />
      ) : (
        <View style={styles.content}>
          {icon ? <Icon name={icon} size={size === "sm" ? 16 : 18} color={labelColor} /> : null}
          <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  /** Desktop Button `sm` / `md` (`h-8` / `h-10`). */
  sm: { height: 32, minHeight: 32, paddingHorizontal: spacing.md },
  md: { height: CONTROL_HEIGHT_MD, minHeight: CONTROL_HEIGHT_MD },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },
  label: { fontSize: 15, fontWeight: "600" },
});
