import { useCallback, useState } from "react";
import { commitIntegerDraft, integerDraftValue, sanitizeIntegerDraft } from "../domain";

export interface UseIntegerDraftOptions {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

/**
 * Text draft for an integer field. While focused the field may be empty or out
 * of range; only valid values reach `onChange`. On blur an empty field becomes
 * 0 and the value is clamped to `[min, max]`.
 */
export function useIntegerDraft({ value, min, max, onChange }: UseIntegerDraftOptions) {
  const [draft, setDraft] = useState<string | null>(null);

  const onChangeText = useCallback(
    (raw: string) => {
      const next = sanitizeIntegerDraft(raw);
      setDraft(next);
      const parsed = integerDraftValue(next, min, max);
      if (parsed !== null && parsed !== value) onChange(parsed);
    },
    [max, min, onChange, value],
  );

  const onFocus = useCallback(() => {
    setDraft(String(value));
  }, [value]);

  const onBlur = useCallback(() => {
    const committed = commitIntegerDraft(draft ?? String(value), min, max);
    setDraft(null);
    if (committed !== value) onChange(committed);
  }, [draft, max, min, onChange, value]);

  return { text: draft ?? String(value), onChangeText, onFocus, onBlur };
}
