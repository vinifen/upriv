import type en from "@i18n/en.json";

/** BCP-47 tags supported by `dev/docs/i18n/`. */
export type LocaleId = "en" | "pt-BR";

/** Stable UI string keys (English slugs — LOCALE.md). */
export type I18nKey = keyof typeof en;

export type I18nCatalog = Record<I18nKey, string>;

export type I18nParams = Record<string, string | number>;
