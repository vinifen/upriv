import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useTheme } from "@/theme";
import { colorAlpha, radii } from "@/theme/tokens";

interface CheckboxProps {
  checked: boolean;
  /** Select-all mixed state — desktop `indeterminate`. */
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}

/** 16px checkbox — desktop logs/backups list parity. */
export function Checkbox({
  checked,
  indeterminate = false,
  disabled = false,
  onChange,
  label,
}: CheckboxProps) {
  const { colors } = useTheme();
  const filled = checked || indeterminate;
  const bg = filled ? colors.accent : colors.surfaceContainerHigh;
  const border = filled ? colors.accent : colorAlpha(colors.outlineVariant, 0.5);

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: indeterminate ? "mixed" : checked, disabled }}
      disabled={disabled}
      hitSlop={12}
      onPress={onChange}
      style={[styles.hit, { opacity: disabled ? 0.4 : 1 }]}
    >
      <View style={[styles.box, { backgroundColor: bg, borderColor: border }]}>
        {indeterminate ? (
          <View style={[styles.dash, { backgroundColor: colors.accentForeground }]} />
        ) : checked ? (
          <Svg width={10} height={10} viewBox="0 0 10 10">
            <Path
              d="M1.5 5.2 3.8 7.5 8.5 2.4"
              stroke={colors.accentForeground}
              strokeWidth={1.6}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  box: {
    width: 16,
    height: 16,
    borderRadius: radii.xs,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dash: {
    width: 8,
    height: 2,
    borderRadius: 1,
  },
});
