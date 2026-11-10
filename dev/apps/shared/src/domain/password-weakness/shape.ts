import { totalLength, type PasswordText } from "./text";
import { SUBSTITUTES } from "./words";

/**
 * Letters a single word can have, in the units of `lengthOf`, so an unspaced
 * Chinese or Korean phrase is not read as one word. Longer, it is as likely to
 * be two words or random text.
 */
const MAX_ONE_WORD_LETTERS = 10;

/** The digits of a year or a whole date. A longer number is more than a decoration. */
const MAX_DECORATION_DIGITS = 8;
const MAX_DECORATION_SYMBOLS = 2;

type CharKind = "letter" | "digit" | "other";

function kindOf(char: string): CharKind {
  if (/\p{L}/u.test(char)) return "letter";
  return /\p{Nd}/u.test(char) ? "digit" : "other";
}

/**
 * Kinds of each character, reading a substitute between two letters as a letter
 * (`P@ki$tan`, `B@byl0ve`). A digit is read that way only beside a symbol that
 * was: random letters and digits are full of digits between letters.
 */
function kindsOf({ chars, lower }: PasswordText): CharKind[] {
  const kinds = chars.map(kindOf);
  const isSubstitute = (index: number) =>
    SUBSTITUTES.has(lower[index]) && kinds[index - 1] === "letter" && kinds[index + 1] === "letter";
  const symbolRead = kinds.some((kind, index) => kind === "other" && isSubstitute(index));
  return kinds.map((kind, index) =>
    isSubstitute(index) && (kind === "other" || symbolRead) ? "letter" : kind,
  );
}

/**
 * Capitals the way a word has them: none, only the first, or all. Any other mix
 * (`CasaAzul`, `RJMarta`, random text) is more than one word written out.
 */
function hasCapitalsOfAWord(word: readonly string[]): boolean {
  const cased = word.filter((char) => char.toLowerCase() !== char.toUpperCase());
  const capitals = cased.map((char) => char !== char.toLowerCase());
  return capitals.every(Boolean) || !capitals.slice(1).some(Boolean);
}

/**
 * One word with a number or a symbol stuck on one side of it: `Goddess1974!`,
 * `Maria25121990`, `elizandra_1978#`, `123456christian`. It is the shape most
 * leaked passwords take, far more often than a word with something on both
 * sides, and the first thing cracking tools try on every word they know. It
 * reads the same in any alphabet, so it needs no word list.
 */
export function isOneWordWithDecoration(text: PasswordText): boolean {
  const kinds = kindsOf(text);
  const first = kinds.indexOf("letter");
  const last = kinds.lastIndexOf("letter");
  const onBothSides = first > 0 && last < kinds.length - 1;
  if (first === -1 || onBothSides) return false;
  const word = text.chars.slice(first, last + 1);
  const stuckOn = first === 0 ? kinds.slice(last + 1) : kinds.slice(0, first);
  const digits = stuckOn.filter((kind) => kind === "digit").length;
  const digitRuns = stuckOn.filter(
    (kind, index) => kind === "digit" && stuckOn[index - 1] !== "digit",
  ).length;
  return (
    kinds.slice(first, last + 1).every((kind) => kind === "letter") &&
    totalLength(word) <= MAX_ONE_WORD_LETTERS &&
    hasCapitalsOfAWord(word) &&
    stuckOn.length > 0 &&
    digitRuns <= 1 &&
    digits <= MAX_DECORATION_DIGITS &&
    stuckOn.length - digits <= MAX_DECORATION_SYMBOLS
  );
}
