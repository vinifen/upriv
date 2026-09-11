import type { I18nKey } from "../../i18n/catalog";
import type { I18nParams } from "../../i18n/types";

/** Read-only label/value row for system and vault info modals. */
export interface InfoField {
  id: string;
  label: string;
  value: string;
}

export interface InfoSection {
  id: string;
  title: string;
  fields: InfoField[];
}

export type InfoTranslate = (key: I18nKey, params?: I18nParams) => string;
