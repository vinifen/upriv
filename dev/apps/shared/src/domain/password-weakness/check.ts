import type { I18nKey } from "../../i18n/catalog";
import { coverPatterns } from "./patterns";
import { isOneWordWithDecoration } from "./shape";
import { lengthOf, readText, totalLength, type Coverage, type Source } from "./text";
import { coverCommonWords, coverKnownText } from "./words";

/** Length below which a password is too short, in the units of `lengthOf`. */
const MIN_LENGTH = 12;

/** What has to be left once everything predictable is set aside, in the units of `worthOf`. */
const MIN_WORTH_LEFT = 8;

/**
 * Different characters a password needs, in the units of `lengthOf`: half its
 * length, up to this many. Fewer is a few keys mashed over and over, however
 * long it goes on. Short random text repeats letters by chance, hence the half.
 */
const MAX_DIFFERENT_NEEDED = 8;

/** How much of a password known text must cover to be the reason: a short word recurs. */
const MIN_KNOWN_SHARE = 1 / 3;

export type PasswordWeakness = "too_short" | "predictable" | "common" | "public" | "current";

export const PASSWORD_WEAKNESS_I18N_KEYS = {
  too_short: "password_weakness.too_short",
  predictable: "password_weakness.predictable",
  common: "password_weakness.common",
  public: "password_weakness.public",
  current: "password_weakness.current",
} as const satisfies Record<PasswordWeakness, I18nKey>;

/** What anyone with a copy of the vault can read without its password. */
export function vaultPublicText(vault: {
  displayName: string;
  passwordHint: string;
  note: string;
}): string[] {
  return [vault.displayName, vault.passwordHint, vault.note];
}

/** A digit comes from ten choices, so it is worth half a letter. */
function worthOf(char: string): number {
  return /\p{Nd}/u.test(char) ? 0.5 : lengthOf(char);
}

function worthLeft(lower: readonly string[], coverage: Coverage): number {
  return lower.reduce((left, char, index) => {
    return coverage[index] === null ? left + worthOf(char) : left;
  }, 0);
}

/**
 * What is objectively wrong with a password, or `null` when nothing is. It says
 * nothing about how strong a password is. Every character counts unless the
 * vault's public text, the current password, a common word, or a pattern gives
 * it away, and a password is flagged when too little is left, when it uses too
 * few different characters, or when it is one word with a number or symbol stuck
 * on it. `currentPassword` is empty unless the password is being changed. It runs
 * on the value the field already holds and keeps nothing.
 */
export function findPasswordWeakness(
  password: string,
  vaultText: readonly string[],
  currentPassword = "",
): PasswordWeakness | null {
  const text = readText(password);
  const { lower, folded } = text;
  if (lower.length === 0) return null;
  const coverage: Coverage = new Array<Coverage[number]>(lower.length).fill(null);
  coverKnownText(folded, [currentPassword], coverage, "current");
  coverKnownText(folded, vaultText, coverage, "public");
  coverCommonWords(folded, coverage);
  coverPatterns(lower, coverage);

  const length = totalLength(lower);
  const enoughLeft =
    worthLeft(lower, coverage) >= MIN_WORTH_LEFT &&
    text.different >= Math.min(MAX_DIFFERENT_NEEDED, Math.ceil(length / 2)) &&
    !isOneWordWithDecoration(text);
  const shareOf = (source: Source) =>
    coverage.filter((covered) => covered === source).length / lower.length;
  if (!enoughLeft && shareOf("current") >= MIN_KNOWN_SHARE) return "current";
  if (!enoughLeft && shareOf("public") >= MIN_KNOWN_SHARE) return "public";
  if (!enoughLeft && coverage.includes("common")) return "common";
  if (length < MIN_LENGTH) return "too_short";
  return enoughLeft ? null : "predictable";
}
