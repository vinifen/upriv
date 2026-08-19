import { useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, interpolate } from "@upriv/shared";
import type { I18nCatalog, LocaleId } from "@upriv/shared";
import { I18nContext, type I18nContextValue, type I18nKey, type I18nParams } from "./context";
import { loadMobileLocaleSync } from "./loadMobileLocale";

export function I18nProvider({
  locale = DEFAULT_LOCALE,
  children,
}: {
  locale?: LocaleId;
  children: ReactNode;
}) {
  const [activeLocale, setActiveLocale] = useState(locale);
  const [catalog, setCatalog] = useState<I18nCatalog>(() => loadMobileLocaleSync(locale));

  useEffect(() => {
    setCatalog(loadMobileLocaleSync(locale));
    setActiveLocale(locale);
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => {
    const t = (key: I18nKey, params?: I18nParams): string => {
      const raw = catalog[key] ?? key;
      return interpolate(raw, params);
    };
    return { locale: activeLocale, catalog, t, ready: true };
  }, [activeLocale, catalog]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

export function useTranslation() {
  const { t, locale, catalog, ready } = useI18n();
  return { t, locale, catalog, ready };
}
