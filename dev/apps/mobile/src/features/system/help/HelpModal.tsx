import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  defaultOpenHelpSections,
  HELP_SECTION_BODY_KEYS,
  HELP_SECTIONS,
  helpSectionTitleKey,
  sectionMatchesQuery,
  type AppDistribution,
  type HelpSectionId,
} from "@upriv/shared";
import { useTranslation, type I18nKey } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import { Modal } from "@/components/ui";
import { SettingsAccordionSection, ThemedInput } from "@/components/settings";
import { getMobileAppVersion } from "@/lib/appVersion";

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

const DISTRIBUTION_LABEL_KEYS: Record<AppDistribution, I18nKey> = {
  portable: "modal.help.distribution.portable",
  installed: "modal.help.distribution.installed",
  dev: "modal.help.distribution.dev",
};

/** Help — same sections/search/footer pattern as desktop HelpModal. */
export function HelpModal({ open, onClose }: HelpModalProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  const [query, setQuery] = useState("");
  const [openSections, setOpenSections] = useState<Set<HelpSectionId>>(defaultOpenHelpSections);
  const [appVersion, setAppVersion] = useState(() => getMobileAppVersion().version);
  const [versionOffline, setVersionOffline] = useState(false);
  const [distribution, setDistribution] = useState<AppDistribution>("installed");

  const searching = query.trim().length > 0;

  useEffect(() => {
    if (!open) {
      setQuery("");
      setOpenSections(defaultOpenHelpSections());
      return;
    }
    const info = getMobileAppVersion();
    setAppVersion(info.version);
    setVersionOffline(info.offline);
    setDistribution(info.distribution);
  }, [open]);

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

  const versionCredit = [
    t(DISTRIBUTION_LABEL_KEYS[distribution]),
    t(versionOffline ? "modal.help.app_version_offline" : "modal.help.app_version", {
      version: appVersion,
    }),
    t("app.credit_author"),
  ].join(" · ");

  const footer = <Text style={[typography.caption, styles.footer]}>{versionCredit}</Text>;

  return (
    <Modal
      open={open}
      title={t("modal.help.title")}
      titleIcon="help"
      onClose={onClose}
      panelClassName="max-w-3xl"
      footer={footer}
    >
      <View style={styles.content}>
        <Text style={typography.bodyMuted}>{t("modal.help.hint")}</Text>

        <ThemedInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("modal.help.search_placeholder")}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          accessibilityLabel={t("modal.help.search_placeholder")}
        />

        {visibleSections.length === 0 ? (
          <Text style={[typography.bodyMuted, styles.empty]}>{t("modal.help.search_empty")}</Text>
        ) : (
          <View style={styles.sections}>
            {visibleSections.map((section) => (
              <SettingsAccordionSection
                key={section.id}
                title={t(helpSectionTitleKey(section.id) as I18nKey)}
                open={searching ? true : openSections.has(section.id)}
                onOpenChange={searching ? undefined : (next) => toggleSection(section.id, next)}
              >
                {HELP_SECTION_BODY_KEYS[section.id].map((bodyKey) => (
                  <Text key={bodyKey} style={[typography.bodyMuted, styles.paragraph]}>
                    {t(bodyKey as I18nKey)}
                  </Text>
                ))}
              </SettingsAccordionSection>
            ))}
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  sections: { gap: spacing.sm },
  empty: { textAlign: "center", paddingVertical: spacing.xxl },
  paragraph: { lineHeight: 22 },
  footer: { textAlign: "center" },
});
