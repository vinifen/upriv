/** Settings number fields hold whole, non-negative values. Keeps digits only. */
export function sanitizeIntegerDraft(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** The typed value when it is already a valid in-range integer; otherwise `null`. */
export function integerDraftValue(draft: string, min: number, max: number): number | null {
  if (draft === "") return null;
  const parsed = Number.parseInt(draft, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

/** Value on blur: an empty field becomes 0, then the result is clamped to `[min, max]`. */
export function commitIntegerDraft(draft: string, min: number, max: number): number {
  const parsed = draft === "" ? 0 : Number.parseInt(draft, 10);
  const value = Number.isFinite(parsed) ? parsed : 0;
  return Math.min(max, Math.max(min, value));
}
