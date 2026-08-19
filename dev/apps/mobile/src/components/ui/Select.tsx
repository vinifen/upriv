import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/icons";
import { Modal } from "./Modal";
import { MenuActionItem } from "./MenuActionItem";
import { useTheme } from "@/theme";
import { radii, spacing } from "@/theme/tokens";

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
}

interface SelectProps<T extends string | number> {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Field label above the control. */
  label?: string;
  /** Picker menu title (defaults to `label`). */
  title?: string;
  accessibilityLabel?: string;
  /** Visual density — `sm` for compact header locale pickers. */
  size?: "sm" | "md";
}

/** Single-value picker — desktop `<select>` parity via compact menu modal. */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  label,
  title,
  accessibilityLabel,
  size = "md",
}: SelectProps<T>) {
  const { colors, typography } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => options.find((o) => o.value === value)?.label ?? String(value),
    [options, value],
  );
  const compact = size === "sm";

  return (
    <View style={styles.wrap}>
      {label && !compact ? <Text style={typography.bodyMuted}>{label}</Text> : null}
      <Pressable
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label ?? selected}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.control,
          compact ? styles.controlSm : null,
          {
            backgroundColor: colors.surfaceContainerHigh,
            borderColor: colors.outlineVariant,
            opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
          },
        ]}
      >
        <Text
          style={[
            compact ? typography.caption : typography.body,
            { color: colors.onSurface, flex: 1 },
          ]}
          numberOfLines={1}
        >
          {selected}
        </Text>
        <Icon name="chevron-down" size={compact ? 14 : 18} color={colors.onSurfaceVariant} />
      </Pressable>

      <Modal
        variant="menu"
        menuPlacement="center"
        open={open}
        title={title ?? label ?? selected}
        onClose={() => setOpen(false)}
      >
        {options.map((opt) => (
          <MenuActionItem
            key={String(opt.value)}
            label={opt.label}
            selected={opt.value === value}
            onPress={() => {
              onChange(opt.value);
              setOpen(false);
            }}
          />
        ))}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  control: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  controlSm: {
    minHeight: 36,
    maxWidth: 148,
    paddingHorizontal: spacing.sm,
  },
});
