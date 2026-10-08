import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { RevealPathButton } from "@/components/RevealPathButton";
import { useTheme } from "@/theme";
import { controlFocusRing, radii, spacing } from "@/theme/tokens";

interface PathFieldProps {
  value: string;
  /** Location the button opens. Defaults to `value`. */
  openPath?: string | null;
  onChangeText?: (value: string) => void;
  editable?: boolean;
  disabled?: boolean;
  placeholder?: string;
  selectTextOnFocus?: boolean;
}

/**
 * One path rectangle with the file-manager button inside it.
 * The button is a flex sibling, so it stays inside the rounded box.
 */
export function PathField({
  value,
  openPath,
  onChangeText,
  editable = true,
  disabled = false,
  placeholder,
  selectTextOnFocus,
}: PathFieldProps) {
  const { colors, typography } = useTheme();
  const [focused, setFocused] = useState(false);
  const locked = !editable || disabled || !onChangeText;
  return (
    <View
      style={[
        styles.field,
        { backgroundColor: colors.surfaceContainerHighest, opacity: disabled ? 0.6 : 1 },
        controlFocusRing(colors.accent, colors.surfaceContainerHighest, focused && !locked),
      ]}
    >
      <TextInput
        value={value}
        editable={!locked}
        selectTextOnFocus={selectTextOnFocus}
        placeholder={placeholder}
        placeholderTextColor={colors.onSurfaceVariant}
        underlineColorAndroid="transparent"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChangeText={onChangeText}
        style={[typography.mono, styles.input, { color: colors.onSurface }]}
      />
      <RevealPathButton path={openPath ?? value} inset />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "stretch",
    overflow: "hidden",
    borderRadius: radii.sm,
    minHeight: 44,
    paddingLeft: spacing.md,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: spacing.md,
    paddingRight: spacing.sm,
    margin: 0,
  },
});
