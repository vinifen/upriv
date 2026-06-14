import { createContext } from "react";
import type { I18nCatalog, I18nKey, I18nParams, LocaleId } from "./types";

export interface I18nContextValue {
  locale: LocaleId;
  catalog: I18nCatalog;
  t: (key: I18nKey, params?: I18nParams) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);
