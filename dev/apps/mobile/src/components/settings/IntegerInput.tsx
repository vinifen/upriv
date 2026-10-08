import type { StyleProp, TextStyle } from "react-native";
import { useIntegerDraft } from "@upriv/shared/react";
import { ThemedInput } from "./settingsFields";

interface IntegerInputProps {
  value: number;
  min: number;
  max?: number;
  disabled?: boolean;
  style?: StyleProp<TextStyle>;
  onChange: (value: number) => void;
}

/** Whole-number field that may be cleared while typing; an empty field becomes 0 on blur. */
export function IntegerInput({
  value,
  min,
  max = Number.MAX_SAFE_INTEGER,
  disabled,
  style,
  onChange,
}: IntegerInputProps) {
  const draft = useIntegerDraft({ value, min, max, onChange });
  return (
    <ThemedInput
      keyboardType="number-pad"
      value={draft.text}
      disabled={disabled}
      onFocus={draft.onFocus}
      onBlur={draft.onBlur}
      onChangeText={draft.onChangeText}
      style={style}
      mono
    />
  );
}
