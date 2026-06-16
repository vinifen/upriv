import type en from "../../locales/en.json";

/** Stable UI string keys (English slugs — LOCALE.md). */
export type I18nKey = keyof typeof en;

export type I18nCatalog = Record<I18nKey, string>;
