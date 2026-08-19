import { createContext } from "react";
import type { I18nCatalog, I18nKey, I18nParams, LocaleId } from "@upriv/shared";

export type { I18nKey, I18nParams, LocaleId };

export interface I18nContextValue {
  locale: LocaleId;
  catalog: I18nCatalog;
  t: (key: I18nKey, params?: I18nParams) => string;
  ready: boolean;
}

export const I18nContext = createContext<I18nContextValue | null>(null);
