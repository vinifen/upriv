import { HELP_SECTION_BODY_KEYS, helpSectionTitleKey, type HelpSectionId } from "./content";

/** Client-side search over static help copy — keep help content free of real paths/secrets in production. */
type Translate = (key: string) => string;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function sectionSearchText(sectionId: HelpSectionId, t: Translate): string {
  return [
    t(helpSectionTitleKey(sectionId)),
    ...HELP_SECTION_BODY_KEYS[sectionId].map((key) => t(key)),
  ].join("\n");
}

export function sectionMatchesQuery(
  sectionId: HelpSectionId,
  query: string,
  t: Translate,
): boolean {
  const normalizedQuery = normalize(query.trim());
  if (!normalizedQuery) return true;
  return normalize(sectionSearchText(sectionId, t)).includes(normalizedQuery);
}
