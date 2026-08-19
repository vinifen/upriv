import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
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
import { radii, spacing } from "@/theme/tokens";
import { Modal } from "@/components/ui";
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
  const { colors, typography } = useTheme();
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

  const toggleSection = (sectionId: HelpSectionId) => {
    if (searching) return;
    setOpenSections((current) => {
      const updated = new Set(current);
      if (updated.has(sectionId)) updated.delete(sectionId);
      else updated.add(sectionId);
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
      onClose={onClose}
      panelClassName="max-w-3xl"
      footer={footer}
    >
      <View style={styles.content}>
        <Text style={typography.bodyMuted}>{t("modal.help.hint")}</Text>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("modal.help.search_placeholder")}
          placeholderTextColor={colors.onSurfaceVariant}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          style={[
            styles.search,
            typography.body,
            {
              backgroundColor: colors.surfaceContainerHigh,
              borderColor: colors.outlineVariant,
              color: colors.onSurface,
            },
          ]}
          accessibilityLabel={t("modal.help.search_placeholder")}
        />

        {visibleSections.length === 0 ? (
          <Text style={[typography.bodyMuted, styles.empty]}>{t("modal.help.search_empty")}</Text>
        ) : (
          visibleSections.map((section) => {
            const isOpen = searching || openSections.has(section.id);
            return (
              <View
                key={section.id}
                style={[
                  styles.sectionCard,
                  {
                    backgroundColor: colors.surfaceContainerHigh,
                    borderColor: colors.outlineVariant,
                  },
                ]}
              >
                <Pressable
                  onPress={() => toggleSection(section.id)}
                  style={styles.sectionHeader}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                >
                  <Text style={[typography.headline, styles.sectionTitle]}>
                    {t(helpSectionTitleKey(section.id) as I18nKey)}
                  </Text>
                  <Text style={typography.bodyMuted}>{isOpen ? "▾" : "▸"}</Text>
                </Pressable>
                {isOpen ? (
                  <View style={styles.sectionBody}>
                    {HELP_SECTION_BODY_KEYS[section.id].map((bodyKey) => (
                      <Text key={bodyKey} style={[typography.bodyMuted, styles.paragraph]}>
                        {t(bodyKey as I18nKey)}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  search: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 44,
  },
  empty: { textAlign: "center", paddingVertical: spacing.xxl },
  sectionCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  sectionTitle: { flex: 1 },
  sectionBody: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  paragraph: { lineHeight: 22 },
  footer: { textAlign: "center" },
});
