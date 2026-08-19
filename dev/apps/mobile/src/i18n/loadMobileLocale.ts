/**
 * Metro-safe locale loader — static requires avoid flaky dynamic import under Expo tsc.
 * Keep catalogs in sync with `@upriv/shared` `locales/`.
 */
import type { I18nCatalog, LocaleId } from "@upriv/shared";
import { DEFAULT_LOCALE } from "@upriv/shared";
import en from "../../../shared/locales/en.json";
import ptBR from "../../../shared/locales/pt-BR.json";
import es from "../../../shared/locales/es.json";

const catalogs: Record<LocaleId, I18nCatalog> = {
  en: en as I18nCatalog,
  "pt-BR": ptBR as I18nCatalog,
  es: es as I18nCatalog,
};

export function loadMobileLocaleSync(locale: LocaleId): I18nCatalog {
  return catalogs[locale] ?? catalogs[DEFAULT_LOCALE];
}

export async function loadMobileLocale(locale: LocaleId): Promise<I18nCatalog> {
  return loadMobileLocaleSync(locale);
}
