import { describe, expect, it } from "vitest";
import en from "../../../shared/locales/en.json";
import es from "../../../shared/locales/es.json";
import ptBR from "../../../shared/locales/pt-BR.json";
import { QUIT_COPY, quitCopyForLocale } from "../quitCopy";

const LOCALES: Record<string, Record<string, string>> = { en, "pt-BR": ptBR, es };

describe("QUIT_COPY", () => {
  it("matches the warning.vault_open_on_exit keys of every shared locale", () => {
    expect(Object.keys(QUIT_COPY).sort()).toEqual(Object.keys(LOCALES).sort());
    for (const [locale, strings] of Object.entries(LOCALES)) {
      expect(QUIT_COPY[locale]).toEqual({
        message: strings["warning.vault_open_on_exit"],
        confirm: strings["warning.vault_open_on_exit_confirm"],
        now: strings["warning.vault_open_on_exit_now"],
        cancel: strings["warning.vault_open_on_exit_cancel"],
      });
    }
  });

  it("falls back to English for a locale it does not carry", () => {
    expect(quitCopyForLocale("fr")).toBe(QUIT_COPY.en);
  });
});
