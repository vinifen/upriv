import { cover, type Coverage } from "./text";

/** Shorter stretches repeat by chance too often to say anything. */
const MIN_COPY = 3;
const MIN_RUN_CHARACTERS = 3;

/** Steady steps a repeating layout needs: fewer happen by chance. */
const MIN_STEADY_STEPS = 3;

/** Keys in a straight line need two steady steps after the first: four keys in all. */
const MIN_LINE_STEPS = 2;

/** Widest shape drawn on the keyboard: `1qaz` then `2wsx` repeats every four keys. */
const MAX_KEY_LAG = 4;

/** Largest steady step between neighbors that still reads as a run: `aceg`, `9753`. */
const MAX_RUN_STEP = 5;

/** Largest step a column of a repeating layout takes: `a1b2c3`, `abc10abc20`. */
const MAX_COLUMN_STEP = 10;

/** Widest layout tried: `word1word2` needs one as wide as the word and its number. */
const MAX_LAG = 16;

const MAX_COUNTING_DIGITS = 6;
const MIN_COUNTED_NUMBERS = 3;
const COUNTING_STEPS = [1, -1, 2, -2, 5, 10];

const DIGIT_ROW = "1234567890-=";
const SHIFTED_DIGIT_ROW = "!@#$%^&*()_+";

/** Each layout, top row first. */
const KEYBOARDS: readonly (readonly string[])[] = [
  [DIGIT_ROW, "qwertyuiop[]", "asdfghjkl;'", "zxcvbnm,./"],
  [DIGIT_ROW, "qwertzuiop", "asdfghjkl", "yxcvbnm"],
  [DIGIT_ROW, "azertyuiop", "qsdfghjklm", "wxcvbn"],
  [DIGIT_ROW, "йцукенгшщзхъ", "фывапролджэ", "ячсмитьбю"],
  ["789", "456", "123", "0"],
];

interface KeyPosition {
  row: number;
  column: number;
}

function keyPositions(rows: readonly string[]): ReadonlyMap<string, KeyPosition> {
  const positions = new Map<string, KeyPosition>();
  const place = (keys: string, row: number) => {
    Array.from(keys).forEach((key, column) => positions.set(key, { row, column }));
  };
  rows.forEach(place);
  if (rows[0] === DIGIT_ROW) place(SHIFTED_DIGIT_ROW, 0);
  return positions;
}

const KEY_POSITIONS = KEYBOARDS.map(keyPositions);

/** How many characters from `i` on copy, or mirror, the text before `i`. */
function longestCopyAt(lower: readonly string[], i: number): number {
  const most = lower.length - i;
  let longest = 0;
  for (let earlier = 0; earlier < i && longest < most; earlier += 1) {
    let copied = 0;
    while (copied < most && lower[earlier + copied] === lower[i + copied]) copied += 1;
    let mirrored = 0;
    while (mirrored < most && lower[earlier - mirrored] === lower[i + mirrored]) mirrored += 1;
    longest = Math.max(longest, copied, mirrored);
  }
  return longest;
}

/** `####`, `abcabc`, `dog12dog34`, `kq8xx8qk`: what the password already said. */
function coverCopies(lower: readonly string[], coverage: Coverage): void {
  let i = 1;
  while (i < lower.length) {
    const length = longestCopyAt(lower, i);
    if (length < MIN_COPY) {
      i += 1;
      continue;
    }
    cover(coverage, i + 1, i + length - 1, "pattern");
    i += length;
  }
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function isLatinLetter(char: string): boolean {
  return char >= "a" && char <= "z";
}

/** A step round a circle of `size`, the short way. */
function roundStep(step: number, size: number): number {
  const half = size / 2;
  return ((step + size + half - 1) % size) - half + 1;
}

/** How far one character is from the next. Digits and letters go round: `9` to `0` is one step. */
function stepBetween(a: string, b: string): number {
  const step = (b.codePointAt(0) ?? 0) - (a.codePointAt(0) ?? 0);
  if (isDigit(a) && isDigit(b)) return roundStep(step, 10);
  if (isLatinLetter(a) && isLatinLetter(b)) return roundStep(step, 26);
  return step;
}

/** Letters and digits have an order people follow; symbols only have code points. */
function hasAnOrder(run: readonly string[]): boolean {
  return run.every((char) => /\p{L}/u.test(char)) || run.every((char) => /\p{N}/u.test(char));
}

/** `abcdef`, `987654`, `aceg`, `ΑΒΓ`, `абвг`, in any script with an order. */
function coverSteadyRuns(lower: readonly string[], coverage: Coverage): void {
  const close = (start: number, end: number, step: number) => {
    const length = end - start + 1;
    if (step === 0 || Math.abs(step) > MAX_RUN_STEP || length < MIN_RUN_CHARACTERS) return;
    if (hasAnOrder(lower.slice(start, end + 1))) cover(coverage, start + 2, end, "pattern");
  };
  if (lower.length < 2) return;
  let start = 0;
  let step = stepBetween(lower[0], lower[1]);
  for (let k = 2; k < lower.length; k += 1) {
    const next = stepBetween(lower[k - 1], lower[k]);
    if (next === step) continue;
    close(start, k - 1, step);
    start = k - 1;
    step = next;
  }
  close(start, lower.length - 1, step);
}

function readsAt(lower: readonly string[], at: number, text: readonly string[]): boolean {
  return text.every((char, offset) => lower[at + offset] === char);
}

/** The characters from `at` up to the next digit, as far as a layout can be wide. */
function gapBeforeDigit(lower: readonly string[], at: number): string[] {
  const gap: string[] = [];
  while (at + gap.length < lower.length && gap.length < MAX_LAG) {
    const char = lower[at + gap.length];
    if (isDigit(char)) break;
    gap.push(char);
  }
  return gap;
}

/** Where the numbers after `first`, with `gap` before each, stop counting by `step`. */
function countingEnd(
  lower: readonly string[],
  at: number,
  first: number,
  step: number,
  gap: readonly string[],
): { end: number; numbers: number } {
  let end = at;
  let numbers = 1;
  for (let value = first + step; value >= 0; value += step) {
    const digits = Array.from(String(value));
    if (!readsAt(lower, end, gap) || !readsAt(lower, end + gap.length, digits)) break;
    end += gap.length + digits.length;
    numbers += 1;
  }
  return { end, numbers };
}

/** `123456789101112`, `500499498`, `abc9abc10abc11`: numbers that gain digits as they count. */
function coverCounting(lower: readonly string[], coverage: Coverage): void {
  for (let i = 0; i < lower.length; i += 1) {
    let digits = "";
    for (let width = 1; width <= MAX_COUNTING_DIGITS; width += 1) {
      const char = lower[i + width - 1] ?? "";
      if (!isDigit(char)) break;
      digits += char;
      const gap = gapBeforeDigit(lower, i + width);
      for (const step of COUNTING_STEPS) {
        const { end, numbers } = countingEnd(lower, i + width, Number(digits), step, gap);
        if (numbers >= MIN_COUNTED_NUMBERS) cover(coverage, i + width, end - 1, "pattern");
      }
    }
  }
}

/**
 * Marks the stretches of at least `minRun` characters that each take the same
 * step as the character `lag` before them. `stepAt(k)` is the step that reaches
 * `k` from `k - lag`, or `null` when there is none worth following.
 */
function coverSteadySteps(
  length: number,
  lag: number,
  minRun: number,
  stepAt: (k: number) => number | null,
  coverage: Coverage,
): void {
  let run = 0;
  for (let k = 2 * lag; k <= length; k += 1) {
    const step = k < length ? stepAt(k) : null;
    if (step !== null && step === stepAt(k - lag)) {
      run += 1;
      continue;
    }
    if (run >= minRun) cover(coverage, k - run, k - 1, "pattern");
    run = 0;
  }
}

/**
 * A layout that comes back with its columns moved on by fixed steps: `a1b2c3`,
 * `aabbcc`, `abc1abc2abc3`, `2024 2025 2026`. A character is predictable when
 * its column takes the same step as the block before.
 */
function coverColumns(lower: readonly string[], coverage: Coverage): void {
  for (let lag = 2; lag <= MAX_LAG; lag += 1) {
    const stepAt = (k: number) => {
      const step = stepBetween(lower[k - lag], lower[k]);
      return Math.abs(step) <= MAX_COLUMN_STEP ? step : null;
    };
    coverSteadySteps(lower.length, lag, Math.max(lag, MIN_STEADY_STEPS), stepAt, coverage);
  }
}

/** The direction from one key to a key touching it, as a number, or `null`. */
function directionBetween(a: KeyPosition | undefined, b: KeyPosition | undefined): number | null {
  if (!a || !b) return null;
  const rows = b.row - a.row;
  const columns = b.column - a.column;
  if (Math.abs(rows) > 1 || Math.abs(columns) > 1 || (rows === 0 && columns === 0)) return null;
  return rows * 3 + columns;
}

/**
 * Keys that keep moving the same way. With a lag of one that is a straight line
 * (`qwerty`, `asdfgh`, `йцукен`, `7410`). Longer lags find the shapes people
 * draw by hopping between lines: `1q2w3e4r`, `qazwsxedc`, `qweasdzxc`, `1qaz2wsx`.
 * Random text touches neighboring keys often, but rarely keeps to one direction.
 */
function coverKeyboardWalks(lower: readonly string[], coverage: Coverage): void {
  for (const positions of KEY_POSITIONS) {
    for (let lag = 1; lag <= MAX_KEY_LAG; lag += 1) {
      const directionAt = (k: number) =>
        directionBetween(positions.get(lower[k - lag]), positions.get(lower[k]));
      const minRun = lag === 1 ? MIN_LINE_STEPS : Math.max(lag, MIN_STEADY_STEPS);
      coverSteadySteps(lower.length, lag, minRun, directionAt, coverage);
    }
  }
}

export function coverPatterns(lower: readonly string[], coverage: Coverage): void {
  coverCopies(lower, coverage);
  coverSteadyRuns(lower, coverage);
  coverCounting(lower, coverage);
  coverColumns(lower, coverage);
  coverKeyboardWalks(lower, coverage);
}
