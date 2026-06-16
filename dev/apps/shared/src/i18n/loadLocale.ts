import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "../domain/app-settings/locales";
import type { LocaleId } from "../domain/app-settings/types";
import type { I18nCatalog } from "./catalog";

export { DEFAULT_LOCALE, SUPPORTED_LOCALES };

const catalogs: Record<LocaleId, () => Promise<I18nCatalog>> = {
  en: () => import("../../locales/en.json").then((m) => m.default as I18nCatalog),
  "pt-BR": () => import("../../locales/pt-BR.json").then((m) => m.default as I18nCatalog),
  es: () => import("../../locales/es.json").then((m) => m.default as I18nCatalog),
};

export async function loadLocale(locale: LocaleId): Promise<I18nCatalog> {
  const loader = catalogs[locale];
  if (!loader) return catalogs[DEFAULT_LOCALE]();
  return loader();
}
