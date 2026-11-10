/** Characters read at most: a longer paste is judged by these, and a keystroke stays quick. */
const MAX_READ_CHARS = 512;

/** Combining marks and joiners belong to the character before them. */
const NOT_A_CHARACTER = /[\p{M}\p{Cf}]/u;

/** The password as the checks read it, one entry per character. */
export interface PasswordText {
  /** As typed. */
  chars: readonly string[];
  /** Lower case. */
  lower: readonly string[];
  /** Lower case with accents dropped, for looking up words. */
  folded: readonly string[];
  /**
   * How many different characters it uses, in the units of `lengthOf`. Marks
   * count here: in Hindi or Thai they are the vowels, and they add variety.
   */
  different: number;
}

/** Chinese characters and Korean syllables each come from thousands: one is worth two letters. */
function isFromThousands(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x3400 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0x20000 && code <= 0x323af)
  );
}

export function lengthOf(char: string): number {
  return isFromThousands(char) ? 2 : 1;
}

export function totalLength(chars: Iterable<string>): number {
  let total = 0;
  for (const char of chars) total += lengthOf(char);
  return total;
}

function foldChar(char: string): string {
  const lower = char.toLowerCase();
  const base = lower.normalize("NFD").replace(/\p{M}/gu, "");
  return Array.from(base).length === 1 ? base : lower;
}

export function readText(text: string): PasswordText {
  const read = Array.from(text.normalize("NFC")).slice(0, MAX_READ_CHARS);
  const chars = read.filter((char) => !NOT_A_CHARACTER.test(char));
  return {
    chars,
    lower: chars.map((char) => char.toLowerCase()),
    folded: chars.map(foldChar),
    different: totalLength(new Set(read.map((char) => char.toLowerCase()))),
  };
}

/**
 * Why a character adds nothing: it is the vault's own text, the current
 * password, a common word, or a pattern.
 */
export type Source = "public" | "current" | "common" | "pattern";

/** For each character, why it adds nothing, or `null` while it still counts. */
export type Coverage = (Source | null)[];

export function cover(coverage: Coverage, from: number, to: number, source: Source): void {
  for (let k = from; k <= to; k += 1) coverage[k] ??= source;
}
