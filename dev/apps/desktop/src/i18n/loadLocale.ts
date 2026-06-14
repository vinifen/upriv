import type { I18nCatalog, LocaleId } from "./types";

const catalogs: Record<LocaleId, () => Promise<I18nCatalog>> = {
  en: () => import("@i18n/en.json").then((m) => m.default as I18nCatalog),
  "pt-BR": () => import("@i18n/pt-BR.json").then((m) => m.default as I18nCatalog),
};

export const DEFAULT_LOCALE: LocaleId = "en";

export const SUPPORTED_LOCALES: readonly LocaleId[] = ["en", "pt-BR"] as const;

export async function loadLocale(locale: LocaleId): Promise<I18nCatalog> {
  const loader = catalogs[locale];
  if (!loader) {
    return catalogs[DEFAULT_LOCALE]();
  }
  return loader();
}
