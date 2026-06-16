import {
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { I18nContext, type I18nContextValue } from "./context";
import { DEFAULT_LOCALE, interpolate, loadLocale } from "@upriv/shared";
import type { I18nCatalog, I18nKey, I18nParams, LocaleId } from "./types";

interface I18nProviderProps {
  locale?: LocaleId;
  children: ReactNode;
}

function createFallbackValue(locale: LocaleId): I18nContextValue {
  const catalog = {} as I18nCatalog;
  const t = (key: I18nKey, params?: I18nParams): string => interpolate(key, params);
  return { locale, catalog, t, ready: false };
}

export function I18nProvider({ locale = DEFAULT_LOCALE, children }: I18nProviderProps) {
  const [activeLocale, setActiveLocale] = useState(locale);
  const [catalog, setCatalog] = useState<I18nCatalog | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadLocale(locale).then((loaded) => {
      if (cancelled) return;
      setCatalog(loaded);
      setActiveLocale(locale);
      document.documentElement.lang = locale;
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => {
    if (!catalog) return createFallbackValue(activeLocale);

    const t = (key: I18nKey, params?: I18nParams): string => {
      const raw = catalog[key] ?? key;
      return interpolate(raw, params);
    };

    return { locale: activeLocale, catalog, t, ready: true };
  }, [activeLocale, catalog]);

  if (!catalog) return null;

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}

/** Shorthand for `useI18n().t`. */
export function useTranslation() {
  const { t, locale, catalog, ready } = useI18n();
  return { t, locale, catalog, ready };
}
