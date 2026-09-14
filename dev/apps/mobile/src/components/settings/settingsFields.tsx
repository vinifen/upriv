import { forwardRef, useState, type ReactNode } from "react";
import {
  Pressable,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { controlFocusRing, radii, spacing } from "@/theme/tokens";

export function FieldLabel({
  children,
  disabled = false,
}: {
  children: string;
  disabled?: boolean;
}) {
  const { colors, typography } = useTheme();
  return (
    <Text
      style={[
        typography.body,
        { color: colors.onSurface, fontWeight: "500" },
        disabled ? styles.labelDisabled : null,
      ]}
    >
      {children}
    </Text>
  );
}

export function FieldHint({
  children,
  disabled = false,
}: {
  children: string;
  disabled?: boolean;
}) {
  const { colors, typography } = useTheme();
  return (
    <Text
      style={[
        typography.caption,
        { color: colors.onSurfaceVariant },
        disabled ? styles.labelDisabled : null,
      ]}
    >
      {children}
    </Text>
  );
}

export const ThemedInput = forwardRef<
  TextInput,
  TextInputProps & { mono?: boolean; disabled?: boolean }
>(function ThemedInput(
  { mono, style, editable = true, disabled = false, onFocus, onBlur, ...rest },
  ref,
) {
  const { colors, typography } = useTheme();
  const [focused, setFocused] = useState(false);
  const fill = colors.surfaceContainerHighest;
  const isEditable = editable && !disabled;
  return (
    <TextInput
      ref={ref}
      collapsable={false}
      placeholderTextColor={colors.onSurfaceVariant}
      importantForAutofill="no"
      {...rest}
      editable={isEditable}
      blurOnSubmit={rest.blurOnSubmit ?? false}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={[
        mono ? typography.mono : typography.body,
        styles.input,
        {
          backgroundColor: fill,
          color: colors.onSurface,
          opacity: disabled ? 0.6 : 1,
        },
        style,
        controlFocusRing(colors.accent, fill, focused && isEditable),
      ]}
      underlineColorAndroid="transparent"
    />
  );
});

/** Masked field with show/hide — eye sits inside the same chrome as desktop `PasswordInput`. */
export const PasswordInput = forwardRef<
  TextInput,
  Omit<TextInputProps, "secureTextEntry"> & { disabled?: boolean }
>(function PasswordInput(
  { style, editable = true, disabled = false, onFocus, onBlur, ...rest },
  ref,
) {
  const { colors, typography } = useTheme();
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const fill = colors.surfaceContainerHighest;
  const isEditable = editable && !disabled;
  return (
    <View
      collapsable={false}
      style={[
        styles.passwordField,
        {
          backgroundColor: fill,
          opacity: isEditable ? 1 : 0.6,
          ...controlFocusRing(colors.accent, fill, focused && isEditable),
        },
      ]}
    >
      <TextInput
        ref={ref}
        collapsable={false}
        {...rest}
        editable={isEditable}
        secureTextEntry={!visible}
        blurOnSubmit={rest.blurOnSubmit ?? false}
        underlineColorAndroid="transparent"
        placeholderTextColor={colors.onSurfaceVariant}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[typography.body, styles.passwordText, { color: colors.onSurface }, style]}
      />
      <Pressable
        onPress={() => setVisible((current) => !current)}
        // Reveal stays available while `editable={false}` (e.g. unlock in progress).
        disabled={disabled}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={visible ? t("action.hide_password") : t("action.show_password")}
        style={styles.eyeBtn}
      >
        <Icon name={visible ? "eye-off" : "eye"} size={18} color={colors.onSurfaceVariant} />
      </Pressable>
    </View>
  );
});

export function SwitchRow({
  label,
  hint,
  value,
  onValueChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={styles.switchRow}
    >
      <View style={styles.switchText} accessible={false}>
        <FieldLabel disabled={disabled}>{label}</FieldLabel>
        {hint ? <FieldHint disabled={disabled}>{hint}</FieldHint> : null}
      </View>
      <View style={styles.switchControl} pointerEvents="none">
        <Switch
          value={value}
          disabled={disabled}
          importantForAccessibility="no"
          trackColor={{ false: colors.outlineVariant, true: colors.accent }}
        />
      </View>
    </Pressable>
  );
}

export function RadioGroup({ children }: { children: ReactNode }) {
  return (
    <View accessibilityRole="radiogroup" style={styles.radioGroup}>
      {children}
    </View>
  );
}

export function Warning({ children }: { children: string }) {
  const { colors, typography } = useTheme();
  return <Text style={[typography.caption, { color: colors.onErrorContainer }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  radioGroup: { gap: spacing.sm },
  input: {
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 44,
  },
  passwordField: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radii.sm,
    minHeight: 44,
    paddingLeft: spacing.md,
    paddingRight: 2,
    overflow: "hidden",
  },
  passwordText: {
    flex: 1,
    minWidth: 0,
    paddingVertical: spacing.md,
    paddingRight: spacing.sm,
    margin: 0,
    includeFontPadding: false,
  },
  eyeBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  switchText: {
    flex: 1,
    gap: 4,
  },
  switchControl: {
    marginTop: 2,
    flexShrink: 0,
  },
  labelDisabled: {
    opacity: 0.6,
  },
});
