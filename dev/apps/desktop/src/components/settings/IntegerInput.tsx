import { useIntegerDraft } from "@upriv/shared/react";

interface IntegerInputProps {
  id?: string;
  value: number;
  min: number;
  max?: number;
  disabled?: boolean;
  className?: string;
  onChange: (value: number) => void;
}

/** Whole-number field that may be cleared while typing; an empty field becomes 0 on blur. */
export function IntegerInput({
  id,
  value,
  min,
  max = Number.MAX_SAFE_INTEGER,
  disabled,
  className,
  onChange,
}: IntegerInputProps) {
  const draft = useIntegerDraft({ value, min, max, onChange });
  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      min={min}
      max={max === Number.MAX_SAFE_INTEGER ? undefined : max}
      step={1}
      value={draft.text}
      disabled={disabled}
      onFocus={draft.onFocus}
      onBlur={draft.onBlur}
      onChange={(event) => draft.onChangeText(event.target.value)}
      className={className}
    />
  );
}
