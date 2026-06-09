import type { I18nKey } from "@/i18n";

export const HELP_SECTIONS = [
  { id: "overview", defaultOpen: true },
  { id: "vault_list", defaultOpen: false },
  { id: "open_close", defaultOpen: false },
  { id: "vault_settings", defaultOpen: false },
  { id: "backups", defaultOpen: false },
  { id: "system_settings", defaultOpen: false },
  { id: "logs", defaultOpen: false },
  { id: "security", defaultOpen: false },
  { id: "recovery", defaultOpen: false },
] as const;

export type HelpSectionId = (typeof HELP_SECTIONS)[number]["id"];

export const HELP_SECTION_BODY_KEYS: Record<HelpSectionId, readonly I18nKey[]> = {
  overview: [
    "modal.help.body.overview.1",
    "modal.help.body.overview.2",
    "modal.help.body.overview.3",
  ],
  vault_list: [
    "modal.help.body.vault_list.1",
    "modal.help.body.vault_list.2",
    "modal.help.body.vault_list.3",
  ],
  open_close: [
    "modal.help.body.open_close.1",
    "modal.help.body.open_close.2",
    "modal.help.body.open_close.3",
  ],
  vault_settings: [
    "modal.help.body.vault_settings.1",
    "modal.help.body.vault_settings.2",
  ],
  backups: ["modal.help.body.backups.1", "modal.help.body.backups.2"],
  system_settings: [
    "modal.help.body.system_settings.1",
    "modal.help.body.system_settings.2",
    "modal.help.body.system_settings.3",
  ],
  logs: ["modal.help.body.logs.1", "modal.help.body.logs.2"],
  security: [
    "modal.help.body.security.1",
    "modal.help.body.security.2",
    "modal.help.body.security.3",
  ],
  recovery: ["modal.help.body.recovery.1", "modal.help.body.recovery.2"],
};

export function helpSectionTitleKey(sectionId: HelpSectionId): I18nKey {
  return `modal.help.section.${sectionId}` as I18nKey;
}

export function defaultOpenHelpSections(): Set<HelpSectionId> {
  return new Set(HELP_SECTIONS.filter((section) => section.defaultOpen).map((section) => section.id));
}
