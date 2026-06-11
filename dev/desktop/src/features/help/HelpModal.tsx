import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { VaultSettingsSection } from "@/features/vault-list/VaultSettingsSection";
import { settingsControlClass } from "@/features/vault-list/vaultSettingsForm";
import {
  defaultOpenHelpSections,
  HELP_SECTION_BODY_KEYS,
  HELP_SECTIONS,
  helpSectionTitleKey,
  type HelpSectionId,
} from "./helpContent";
import { sectionMatchesQuery } from "./helpSearch";

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

export function HelpModal({ open, onClose }: HelpModalProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [openSections, setOpenSections] = useState<Set<HelpSectionId>>(defaultOpenHelpSections);

  const searching = query.trim().length > 0;

  useEffect(() => {
    if (!open) {
      setQuery("");
      setOpenSections(defaultOpenHelpSections());
    }
  }, [open]);

  const visibleSections = useMemo(
    () => HELP_SECTIONS.filter((section) => sectionMatchesQuery(section.id, query, t)),
    [query, t],
  );

  const toggleSection = (sectionId: HelpSectionId, next: boolean) => {
    setOpenSections((current) => {
      const updated = new Set(current);
      if (next) updated.add(sectionId);
      else updated.delete(sectionId);
      return updated;
    });
  };

  if (!open) return null;

  return (
    <Modal open={open} title={t("modal.help.title")} onClose={onClose} panelClassName="max-w-3xl">
      <p className="mb-4 text-sm text-on-surface-variant">{t("modal.help.hint")}</p>

      <label className="mb-4 block">
        <span className="sr-only">{t("modal.help.search_placeholder")}</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("modal.help.search_placeholder")}
          className={`${settingsControlClass} placeholder:text-on-surface-variant/70`}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      {visibleSections.length === 0 ? (
        <p className="py-10 text-center text-sm text-on-surface-variant">
          {t("modal.help.search_empty")}
        </p>
      ) : (
        <div className="modal-scroll-pane max-h-[min(65vh,36rem)] space-y-1.5 sm:space-y-2">
          {visibleSections.map((section) => (
            <VaultSettingsSection
              key={section.id}
              title={t(helpSectionTitleKey(section.id))}
              open={searching ? true : openSections.has(section.id)}
              onOpenChange={searching ? undefined : (next) => toggleSection(section.id, next)}
            >
              <div className="space-y-3">
                {HELP_SECTION_BODY_KEYS[section.id].map((bodyKey) => (
                  <p key={bodyKey} className="text-sm leading-relaxed text-on-surface-variant">
                    {t(bodyKey)}
                  </p>
                ))}
              </div>
            </VaultSettingsSection>
          ))}
        </div>
      )}
    </Modal>
  );
}
