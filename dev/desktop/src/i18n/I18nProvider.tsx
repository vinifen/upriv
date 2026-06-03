import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { I18nContext, type I18nContextValue } from "./context";
import { interpolate } from "./interpolate";
import { DEFAULT_LOCALE, loadLocale } from "./loadLocale";
import type { I18nCatalog, I18nKey, I18nParams, LocaleId } from "./types";

interface I18nProviderProps {
  locale?: LocaleId;
  children: ReactNode;
}

export function I18nProvider({ locale = DEFAULT_LOCALE, children }: I18nProviderProps) {
  const [catalog, setCatalog] = useState<I18nCatalog | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadLocale(locale).then((loaded) => {
      if (!cancelled) setCatalog(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const value = useMemo<I18nContextValue | null>(() => {
    if (!catalog) return null;

    const t = (key: I18nKey, params?: I18nParams): string => {
      const raw = catalog[key] ?? key;
      return interpolate(raw, params);
    };

    return { locale, catalog, t };
  }, [catalog, locale]);

  if (!value) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-on-surface" />
    );
  }

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
  const { t, locale, catalog } = useI18n();
  return { t, locale, catalog };
}

/** Stable callback reference for child components. */
export function useTranslate() {
  const { t } = useI18n();
  return useCallback((key: I18nKey, params?: I18nParams) => t(key, params), [t]);
}
