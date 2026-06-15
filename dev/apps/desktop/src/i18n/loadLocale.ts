import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type LocaleId } from "@upriv/shared";
import type { I18nCatalog } from "./types";

export { DEFAULT_LOCALE, SUPPORTED_LOCALES };

const catalogs: Record<LocaleId, () => Promise<I18nCatalog>> = {
  en: () => import("@i18n/en.json").then((m) => m.default as I18nCatalog),
  "pt-BR": () => import("@i18n/pt-BR.json").then((m) => m.default as I18nCatalog),
};

export async function loadLocale(locale: LocaleId): Promise<I18nCatalog> {
  const loader = catalogs[locale];
  if (!loader) {
    return catalogs[DEFAULT_LOCALE]();
  }
  return loader();
}
