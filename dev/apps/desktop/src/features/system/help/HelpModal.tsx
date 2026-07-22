import { useEffect, useMemo, useState } from "react";
import type { I18nKey } from "@/i18n";
import { Modal } from "@/components/ui";
import { VaultSettingsSection, settingsControlClass } from "@/components/settings";
import { useTranslation } from "@/i18n";
import { APP_VERSION, getAppVersion, getSessionAppVersion } from "@/lib";
import { useDesktopEvent } from "@/lib/useDesktopEvent";
import type { AppDistribution } from "@upriv/shared";
import {
  defaultOpenHelpSections,
  HELP_SECTION_BODY_KEYS,
  HELP_SECTIONS,
  helpSectionTitleKey,
  sectionMatchesQuery,
  type HelpSectionId,
} from "@upriv/shared";

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

const DISTRIBUTION_LABEL_KEYS: Record<AppDistribution, I18nKey> = {
  portable: "modal.help.distribution.portable",
  installed: "modal.help.distribution.installed",
  dev: "modal.help.distribution.dev",
};

function distributionLabelKey(distribution: AppDistribution): I18nKey {
  return DISTRIBUTION_LABEL_KEYS[distribution] ?? "modal.help.distribution.portable";
}

function initialVersionLabel(): string {
  return getSessionAppVersion()?.version ?? APP_VERSION;
}

function initialDistribution(): AppDistribution | null {
  return getSessionAppVersion()?.distribution ?? null;
}

export function HelpModal({ open, onClose }: HelpModalProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [openSections, setOpenSections] = useState<Set<HelpSectionId>>(defaultOpenHelpSections);
  const [appVersion, setAppVersion] = useState(initialVersionLabel);
  const [versionOffline, setVersionOffline] = useState(false);
  const [distribution, setDistribution] = useState<AppDistribution | null>(initialDistribution);

  const searching = query.trim().length > 0;

  const refreshVersion = () => {
    void getAppVersion().then((info) => {
      setAppVersion(info.version);
      setVersionOffline(Boolean(info.offline));
      setDistribution(info.distribution ?? null);
    });
  };

  useEffect(() => {
    if (!open) {
      setQuery("");
      setOpenSections(defaultOpenHelpSections());
      return;
    }
    refreshVersion();
  }, [open]);

  // If the modal stays open across a daemon reconnect, refresh footer labels.
  useDesktopEvent("daemon_ready", () => {
    if (open) refreshVersion();
  });

  const visibleSections = useMemo(
    () =>
      HELP_SECTIONS.filter((section) =>
        sectionMatchesQuery(section.id, query, (key) => t(key as I18nKey)),
      ),
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

  const versionCredit = (
    <>
      {distribution ? <>{t(distributionLabelKey(distribution))} · </> : null}
      {t(versionOffline ? "modal.help.app_version_offline" : "modal.help.app_version", {
        version: appVersion,
      })}{" "}
      · {t("app.credit_author")}
    </>
  );

  return (
    <Modal
      open={open}
      title={t("modal.help.title")}
      onClose={onClose}
      panelClassName="max-w-3xl"
      footer={
        <p className="text-center font-mono text-xs text-on-surface-variant/80">{versionCredit}</p>
      }
    >
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
        <div className="space-y-1.5 sm:space-y-2">
          {visibleSections.map((section) => (
            <VaultSettingsSection
              key={section.id}
              title={t(helpSectionTitleKey(section.id) as I18nKey)}
              open={searching ? true : openSections.has(section.id)}
              onOpenChange={searching ? undefined : (next) => toggleSection(section.id, next)}
            >
              <div className="space-y-3">
                {HELP_SECTION_BODY_KEYS[section.id].map((bodyKey) => (
                  <p key={bodyKey} className="text-sm leading-relaxed text-on-surface-variant">
                    {t(bodyKey as I18nKey)}
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
