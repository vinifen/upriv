import type en from "@i18n/en.json";
import type { I18nParams as SharedI18nParams, LocaleId } from "@upriv/shared";

export type { LocaleId };

/** Stable UI string keys (English slugs — LOCALE.md). */
export type I18nKey = keyof typeof en;

export type I18nCatalog = Record<I18nKey, string>;

export type I18nParams = SharedI18nParams;
