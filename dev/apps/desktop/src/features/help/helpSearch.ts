import type { I18nKey } from "@/i18n";
import {
  sectionMatchesQuery as sharedSectionMatchesQuery,
  sectionSearchText as sharedSectionSearchText,
  type HelpSectionId,
} from "@upriv/shared";

type Translate = (key: I18nKey) => string;

export function sectionSearchText(sectionId: HelpSectionId, t: Translate): string {
  return sharedSectionSearchText(sectionId, (key) => t(key as I18nKey));
}

export function sectionMatchesQuery(
  sectionId: HelpSectionId,
  query: string,
  t: Translate,
): boolean {
  return sharedSectionMatchesQuery(sectionId, query, (key) => t(key as I18nKey));
}
