import type { I18nKey } from "@/i18n";
import {
  defaultOpenHelpSections as sharedDefaultOpenHelpSections,
  HELP_SECTION_BODY_KEYS as sharedHelpSectionBodyKeys,
  HELP_SECTIONS as sharedHelpSections,
  helpSectionTitleKey as sharedHelpSectionTitleKey,
  type HelpSectionId,
} from "@upriv/shared";

export const HELP_SECTIONS = sharedHelpSections;
export type { HelpSectionId };
export const HELP_SECTION_BODY_KEYS = sharedHelpSectionBodyKeys as Record<
  HelpSectionId,
  readonly I18nKey[]
>;

export function helpSectionTitleKey(sectionId: HelpSectionId): I18nKey {
  return sharedHelpSectionTitleKey(sectionId) as I18nKey;
}

export function defaultOpenHelpSections(): Set<HelpSectionId> {
  return sharedDefaultOpenHelpSections();
}
