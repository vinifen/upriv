import { cover, readText, type Coverage, type Source } from "./text";

/** Shorter words of the text a password is held against match too much by chance. */
const MIN_KNOWN_WORD = 3;

/**
 * The word for "password" in the languages people use most, and the few bases
 * people everywhere build passwords on. Only these: a longer list would be
 * partial in every language and would ask to be kept up to date.
 */
const COMMON_WORDS = [
  "password",
  "passwd",
  "passwort",
  "kennwort",
  "senha",
  "contraseña",
  "motdepasse",
  "parola",
  "wachtwoord",
  "hasło",
  "haslo",
  "heslo",
  "lösenord",
  "passord",
  "adgangskode",
  "salasana",
  "jelszó",
  "şifre",
  "lozinka",
  "matkhau",
  "katasandi",
  "пароль",
  "gfhjkm",
  "κωδικός",
  "סיסמה",
  "كلمة السر",
  "كلمةالسر",
  "كلمة المرور",
  "رمز عبور",
  "पासवर्ड",
  "পাসওয়ার্ড",
  "รหัสผ่าน",
  "密码",
  "密碼",
  "パスワード",
  "ぱすわーど",
  "비밀번호",
  "암호",
  "admin",
  "administrator",
  "welcome",
  "letmein",
  "iloveyou",
  "changeme",
];

function asKey(word: string): string {
  return readText(word).folded.join("");
}

const COMMON_WORD_KEYS: ReadonlySet<string> = new Set(COMMON_WORDS.map(asKey));

/** What people type for a letter, read when looking for a common word or a single word. */
export const SUBSTITUTES: ReadonlyMap<string, string> = new Map([
  ["@", "a"],
  ["4", "a"],
  ["3", "e"],
  ["1", "i"],
  ["!", "i"],
  ["0", "o"],
  ["$", "s"],
  ["5", "s"],
  ["7", "t"],
]);

/** Marks every place `words` appears. Its first character still counts, as naming the word. */
function coverWords(
  folded: readonly string[],
  words: ReadonlySet<string>,
  coverage: Coverage,
  source: Source,
): void {
  const lengths = new Set(Array.from(words, (word) => Array.from(word).length));
  for (let i = 0; i < folded.length; i += 1) {
    for (const length of lengths) {
      if (i + length > folded.length) continue;
      const key = folded.slice(i, i + length).join("");
      if (words.has(key)) cover(coverage, i + 1, i + length - 1, source);
    }
  }
}

export function coverCommonWords(folded: readonly string[], coverage: Coverage): void {
  const read = folded.map((char) => SUBSTITUTES.get(char) ?? char);
  coverWords(read, COMMON_WORD_KEYS, coverage, "common");
}

/**
 * Each entry whole, and its words and numbers: `Summer2024!` gives `summer` and
 * `2024`. An entry is read as far as a password is, so a long note costs a
 * keystroke no more than a short one.
 */
function knownWords(entries: readonly string[]): Set<string> {
  const words = new Set<string>();
  const add = (word: string) => {
    if (Array.from(word).length >= MIN_KNOWN_WORD) words.add(word);
  };
  for (const entry of entries) {
    const key = asKey(entry.trim());
    add(key);
    for (const part of key.split(/[^\p{L}\p{N}]+/u)) {
      add(part);
      for (const run of part.match(/\p{L}+|\p{N}+/gu) ?? []) add(run);
    }
  }
  return words;
}

export function coverKnownText(
  folded: readonly string[],
  entries: readonly string[],
  coverage: Coverage,
  source: Source,
): void {
  coverWords(folded, knownWords(entries), coverage, source);
}
