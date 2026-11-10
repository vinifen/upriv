import { describe, expect, it } from "vitest";
import { findPasswordWeakness, vaultPublicText } from "../check";

function check(password: string, context: readonly string[] = []) {
  return findPasswordWeakness(password, context);
}

function written(next: (step: number) => string, length: number): string {
  let text = "";
  for (let step = 0; text.length < length; step += 1) text += next(step);
  return text.slice(0, length);
}

/** Text with no rule in it, the same on every run. */
function random(length: number, alphabet: string, seed: number): string {
  let state = seed;
  let text = "";
  while (text.length < length) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    text += alphabet[(state >>> 12) % alphabet.length];
  }
  return text;
}

const PRINTABLE = Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i)).join("");

describe("findPasswordWeakness", () => {
  it("has nothing to say about an empty field", () => {
    expect(check("")).toBeNull();
  });

  it.each(["abc", "Summer2024!", "#Vini123#42", "xk#9qL"])("calls %s too short", (password) => {
    expect(check(password)).toBe("too_short");
  });

  it("counts a Chinese character or a Korean syllable as two letters", () => {
    expect(check("昨天晚上朋友")).toBeNull();
    expect(check("昨天晚上朋")).toBe("too_short");
    expect(check("비밀의정원에")).toBeNull();
  });

  it("does not count combining marks as characters", () => {
    expect(check("नमस्ते")).toBe("too_short");
  });

  it.each([
    "aaaaaaaaaaaaaaaa",
    "#".repeat(228),
    `${"#".repeat(227)}3`,
    "abcabcabcabc",
    "abababababab",
    "dogcatdogcatdogcat",
    "kqzvwjjwvzqk",
    "fdsafsdfdsafsd",
  ])("sees %s as saying the same thing again", (password) => {
    expect(check(password)).toBe("predictable");
  });

  it.each([
    "abcdefghijklmnop",
    "zyxwvutsrqponm",
    "123456789012345",
    "987654321098",
    "acegikmoqsuwyac",
    "абвгдежзийкл",
  ])("sees %s as a straight run", (password) => {
    expect(check(password)).toBe("predictable");
  });

  it.each([
    "qwertyuiop12",
    "qwerty123456",
    "1qaz2wsx3edc",
    "asdfghjkl;'zx",
    "zxcvbnmasdfgh",
    "!@#$%^&*()_+",
    "azertyuiop12",
    "qwertzuiop12",
    "йцукенгшщзхъ",
    "ЙЦУКЕН123456",
  ])("sees %s as a line of keys", (password) => {
    expect(check(password)).toBe("predictable");
  });

  it.each([
    "1q2w3e4r5t6y",
    "q1w2e3r4t5y6",
    "qazwsxedcrfv",
    "qazwsxedc123",
    "123qweasdzxc",
    "qweasdzxc123",
    "zxcasdqwe123",
    "1!2@3#4$5%6^",
  ])("sees %s as a shape drawn on the keys", (password) => {
    expect(check(password)).toBe("predictable");
  });

  it.each([
    "Goddess1974!",
    "goddess1974!",
    "Stanford2012!#",
    "Stanford@2012",
    "Fernanda2023",
    "Artur05121991",
    "elizandra_1978#",
    "Inacio7218!!",
    "Gabriel123456",
    "123456christian",
    "GODDESS1974!!",
    "P@ki$tan2020!",
    "Bl@hbl0h2011!",
    "Любовь202419!",
    "भारतसरकारदेश1990",
  ])("sees %s as one word with a number stuck on", (password) => {
    expect(check(password)).toBe("predictable");
  });

  it.each([
    "CasaAzul2024!",
    "ProiboCustomary3958!",
    "Maria#Silva#1990",
    "chocolatefarmhouse2024!",
    "#Vinicius123#42",
    "Maria8372910465",
    "Gabriel!9$2@7#5",
    "昨天晚上我和朋友2024",
  ])("leaves %s alone: it is more than one word and a number", (password) => {
    expect(check(password)).toBeNull();
  });

  it.each(["#Fernanda2023!", "!Stanford2012#", "#Fernanda2023", "2023Fernanda!"])(
    "leaves %s alone: what is stuck on the word is on both sides",
    (password) => {
      expect(check(password)).toBeNull();
    },
  );

  it.each(["#RJMarta2024!", "RJMarta2024!#", "FeRnanda2023!", "mARIANA1990!#"])(
    "leaves %s alone: its capitals are not a word's",
    (password) => {
      expect(check(password)).toBeNull();
    },
  );

  it("does not guess at a long word it has no list for", () => {
    expect(check("unbelievable")).toBeNull();
  });

  it("reads a few Chinese characters and a number as one word", () => {
    expect(check("我爱中国2024")).toBe("predictable");
  });

  it("sees a few keys mashed over and over, however long", () => {
    expect(check(random(20, "asdfjk", 5))).toBe("predictable");
    expect(check(random(64, "asdfjkl", 6))).toBe("predictable");
  });

  it("does not hold chance repeats in short random text against it", () => {
    expect(check("vxkqbvmzthqk")).toBeNull();
  });

  it.each([
    ["counting up", (length: number) => written((n) => String(n + 1), length)],
    ["counting down", (length: number) => written((n) => String(500 - n), length)],
    ["counting by tens", (length: number) => written((n) => String(10 * (n + 1)), length)],
    ["counting with zeros", (length: number) => written((n) => String(n).padStart(3, "0"), length)],
    ["a word and a count", (length: number) => written((n) => `abc${n + 1}`, length)],
    [
      "letters and digits in turn",
      (length: number) => written((n) => `${String.fromCharCode(97 + (n % 26))}${n % 10}`, length),
    ],
    ["years in a row", (length: number) => written((n) => `${1950 + n} `, length)],
  ])("sees through %s at any length", (_name, text) => {
    for (const length of [16, 32, 64, 128, 256]) {
      expect(check(text(length)), `${length}`).toBe("predictable");
    }
  });

  it("does not take doubled characters for variety", () => {
    expect(check("112233445566")).toBe("predictable");
    expect(check("aabbccddeeff")).toBe("predictable");
  });

  it("gives digits half the weight of letters", () => {
    expect(check("834729105623")).toBe("predictable");
    expect(check(random(24, "0123456789", 3))).toBeNull();
  });

  it.each([
    "password",
    "Password12345",
    "#Password2024!",
    "P@ssw0rd123!",
    "p4$$w0rd2024!",
    "senha12345678",
    "haslo12345678",
    "contraseña2024",
    "motdepasse1234",
    "пароль123456",
    "Пароль2024!!",
    "密码123456789",
    "パスワード123456",
    "비밀번호12345678",
    "admin12345678",
    "iloveyou12345",
  ])("sees %s as built on a common word", (password) => {
    expect(check(password)).toBe("common");
  });

  it("keeps a good password that happens to hold a common word", () => {
    expect(check("my password is tall and blue")).toBeNull();
  });

  it("sees a password built on the vault's own text", () => {
    expect(check("Lighthouse Ledger 7", ["Lighthouse Ledger", "", ""])).toBe("public");
    expect(check("Lighthouse2024!!", ["Lighthouse Ledger", "", ""])).toBe("public");
    expect(check("#Lighthouse2024!", ["Lighthouse Ledger", "", ""])).toBe("public");
    expect(check("minhagatamimi", ["", "minha gata mimi", ""])).toBe("public");
    expect(check("Coração2024!!", ["", "", "meu coracao"])).toBe("public");
  });

  it("sees a new password built on the current one", () => {
    expect(findPasswordWeakness("Kestrel!Falls2025", [], "Kestrel!Falls2024")).toBe("current");
    expect(findPasswordWeakness("Xk9#qL2mP7$w", [], "Xk9#qL2mP7$v")).toBe("current");
  });

  it("names the current password before the vault's text", () => {
    const vaultText = ["Lighthouse Ledger", "", ""];
    expect(findPasswordWeakness("Lighthouse2024!!", vaultText, "Lighthouse2024!")).toBe("current");
  });

  it("leaves a new password alone when it has enough besides the current one", () => {
    expect(findPasswordWeakness("the ledger of a quiet harbor", [], "Ledger2024")).toBeNull();
  });

  it("does not blame the vault's text for a short word that turns up by chance", () => {
    expect(check("Xk9#the", ["", "", "the river"])).toBe("too_short");
  });

  it("ignores the vault's words in a password that has enough besides them", () => {
    expect(check("the ledger of a quiet harbor", ["Ledger", "", ""])).toBeNull();
  });

  it.each([
    "UmaVezNasciBem1$",
    "correct-horse-battery-staple",
    "correcthorsebatterystaple",
    "minha casa azul tem janelas verdes",
    "Xk9#qL2mP7$v",
    "8f3kLp0zQ1vX",
    "Ana&Pedro#2019casamento",
    "the old man walked slowly down to the river",
    "were tree poor upon",
    "вчера вечером мы гуляли",
    "昨天晚上我和朋友",
    "मेरा नाम राहुल है और मैं",
    "こんにちはせかいのみなさん",
    "مرحبا بالعالم الجميل",
  ])("leaves %s alone", (password) => {
    expect(check(password)).toBeNull();
  });

  it("reads what comes after a key held down", () => {
    const held = `${"#".repeat(40)}s${"#".repeat(83)}434325634sret`;
    expect(check(held)).toBeNull();
  });

  it.each([
    ["printable characters", PRINTABLE],
    ["letters and digits", "abcdefghijklmnopqrstuvwxyz0123456789"],
    ["lower-case letters", "abcdefghijklmnopqrstuvwxyz"],
  ])("rarely flags 12 random %s", (_name, alphabet) => {
    let flagged = 0;
    for (let seed = 1; seed <= 2000; seed += 1) {
      if (check(random(12, alphabet, seed)) !== null) flagged += 1;
    }
    expect(flagged / 2000).toBeLessThan(0.02);
  });

  it("gives an answer for any text", () => {
    const characters = Array.from("aZ09 !#$-_.çãéñ́ßİΑΒΓЯ漢🔒🗝️‍\t");
    for (let seed = 1; seed <= 300; seed += 1) {
      const indexes = random(1 + (seed % 200), PRINTABLE, seed);
      const password = Array.from(indexes, (char) => {
        return characters[(char.codePointAt(0) ?? 0) % characters.length];
      }).join("");
      const answer = findPasswordWeakness(
        password,
        [password.slice(0, 5), "  ", ""],
        password.slice(2, 9),
      );
      expect([null, "too_short", "predictable", "common", "public", "current"]).toContain(answer);
    }
  });

  it("reads a huge paste", () => {
    expect(check("#".repeat(1_000_000))).toBe("predictable");
  });
});

describe("vaultPublicText", () => {
  it("lists what the vault shows without its password", () => {
    expect(
      vaultPublicText({ displayName: "Taxes", passwordHint: "first dog", note: "tax papers" }),
    ).toEqual(["Taxes", "first dog", "tax papers"]);
  });
});
