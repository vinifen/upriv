import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon, type IconName } from "@/components/icons";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import { useDropdownPanelClose } from "./DropdownPanel";

interface MenuActionItemProps {
  label: string;
  description?: string;
  icon?: IconName;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Highlight as the current choice (sort/view menus) — desktop checkmark parity. */
  selected?: boolean;
}

/** Icon + label row — desktop `menuItem` / `MenuPanelOption` parity (flat, not cards). */
export function MenuActionItem({
  label,
  description,
  icon,
  onPress,
  disabled,
  danger,
  selected,
}: MenuActionItemProps) {
  const { colors, typography } = useTheme();
  const closeMenu = useDropdownPanelClose();
  const labelColor = danger
    ? colors.onErrorContainer
    : selected
      ? colors.onSurface
      : colors.onSurface;
  const iconColor = danger
    ? colors.onErrorContainer
    : selected
      ? colors.onSurface
      : colors.onSurfaceVariant;

  return (
    <Pressable
      onPress={() => {
        onPress();
        closeMenu();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: selected === true, disabled: disabled === true }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: selected || pressed ? colors.surfaceContainerHighest : "transparent",
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      {icon ? (
        <View style={styles.iconSlot}>
          <Icon name={icon} size={18} color={iconColor} />
        </View>
      ) : null}
      <View style={styles.textCol}>
        <Text
          style={[
            typography.body,
            {
              color: labelColor,
              fontWeight: selected ? "600" : "400",
              includeFontPadding: false,
            },
          ]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {label}
        </Text>
        {description ? (
          <Text style={[typography.caption, { color: colors.onSurfaceVariant }]} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>
      {selected !== undefined ? (
        <Text
          style={[styles.check, { color: selected ? colors.vaultStatusOpen : "transparent" }]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          ✓
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /** Desktop `menuItemClass`: px-4 py-3 gap-3 — icon tops with the first text line. */
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    borderRadius: 0,
    minHeight: 48,
  },
  iconSlot: {
    width: 20,
    height: 20,
    marginTop: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  textCol: { flex: 1, gap: 2, minWidth: 0 },
  check: {
    width: 16,
    marginTop: 2,
    textAlign: "center",
    fontSize: 12,
    fontFamily: "monospace",
  },
});
