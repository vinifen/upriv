/**
 * Intl objects cost far more to build than to use, and list rows format and
 * sort on every render, so each one here is built once and kept. Each also
 * fixes the device time zone and language it was built with. Those are read
 * again at most once a second, and a change drops every kept object, so the
 * output matches building a new one on each call.
 */
const DEVICE_RECHECK_MS = 1_000;

type Kept = Intl.DateTimeFormat | Intl.Collator;

const kept = new Map<string, Kept>();
let device = "";
let checkedAt = Number.NEGATIVE_INFINITY;

function keep<T extends Kept>(key: string, build: () => T): T {
  const now = Date.now();
  // A clock set back reads the device again too.
  if (now - checkedAt >= DEVICE_RECHECK_MS || now < checkedAt) {
    checkedAt = now;
    const { locale, timeZone } = new Intl.DateTimeFormat().resolvedOptions();
    const current = `${locale}\u0000${timeZone}`;
    if (current !== device) {
      device = current;
      kept.clear();
    }
  }
  let value = kept.get(key) as T | undefined;
  if (!value) {
    value = build();
    kept.set(key, value);
  }
  return value;
}

/** Date and time in `locale`: medium date, short time, device time zone. */
export function isoDateFormat(locale: string): Intl.DateTimeFormat {
  return keep(
    `iso-date\u0000${locale}`,
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
  );
}

/** Compares as `a.localeCompare(b)` does. */
export function deviceCollator(): Intl.Collator {
  return keep("collator", () => new Intl.Collator());
}

/**
 * Compares as `a.localeCompare(b, undefined, { sensitivity: "base" })` does:
 * case and accents aside.
 */
export function baseCollator(): Intl.Collator {
  return keep("collator-base", () => new Intl.Collator(undefined, { sensitivity: "base" }));
}
