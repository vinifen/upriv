import { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { mixHex, POLICY_RADIO_BADGE_I18N, type PolicyRadioBadge } from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { useTheme, type ThemeColors } from "@/theme";
import { colorAlpha, radii, spacing } from "@/theme/tokens";

type Tone = "default" | "less-secure" | "insecure";

interface PolicyRadioOptionProps {
  value: string;
  checked: boolean;
  title: string;
  /** Optional leading icon (sits before the title). */
  icon?: ReactNode;
  description?: string;
  disabled?: boolean;
  badge?: PolicyRadioBadge;
  tone?: Tone;
  /**
   * Yellow/amber border while this option still needs follow-up config
   * (e.g. vault-root incomplete policy). Overrides the accent border when checked.
   */
  attention?: boolean;
  /** Extra controls under the description — always visible; inactive until this option is selected. */
  footer?: ReactNode;
  onSelect: () => void;
  accessibilityLabel?: string;
}

function policyRadioBadgeColors(
  badge: PolicyRadioBadge,
  colors: ThemeColors,
): { backgroundColor: string; color: string } {
  switch (badge) {
    case "more-secure":
      return {
        backgroundColor: colorAlpha(colors.vaultStatusOpen, 0.2),
        color: colors.vaultStatusOpen,
      };
    case "less-secure":
      return {
        backgroundColor: colorAlpha(colors.onErrorContainer, 0.15),
        color: colors.onErrorContainer,
      };
    case "insecure":
      return {
        backgroundColor: colorAlpha(colors.onErrorContainer, 0.3),
        color: colors.onErrorContainer,
      };
    case "recommended":
    case "default":
      return {
        backgroundColor: colorAlpha(colors.accent, 0.15),
        color: colors.accent,
      };
  }
}

/**
 * RN parity for the desktop `PolicyRadioOption`.
 *
 * Card-styled radio: checked uses an accent border; `attention` (unresolved
 * incomplete-replace) overrides that with amber. Risk tones tint the fill and
 * title only — idle outline stays `outline-variant`, same as desktop.
 */
export function PolicyRadioOption({
  value,
  checked,
  title,
  icon,
  description,
  disabled = false,
  badge,
  tone = "default",
  attention = false,
  footer,
  onSelect,
  accessibilityLabel,
}: PolicyRadioOptionProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();

  const isLessSecure = tone === "less-secure";
  const isInsecure = tone === "insecure";

  const borderColor = checked
    ? attention
      ? colors.vaultStatusRecovery
      : colors.accent
    : colors.outlineVariant;

  const cardBg = isInsecure
    ? mixHex(colors.surfaceContainer, colors.errorContainer, 0.18)
    : isLessSecure
      ? mixHex(colors.surfaceContainer, colors.errorContainer, 0.07)
      : colors.surfaceContainer;

  const badgeLabel = badge ? t(POLICY_RADIO_BADGE_I18N[badge]) : null;
  const badgeTone = badge ? policyRadioBadgeColors(badge, colors) : null;

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => {
          if (disabled) return;
          onSelect();
        }}
        disabled={disabled}
        accessibilityRole="radio"
        accessibilityState={{ checked, disabled }}
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityValue={{ text: value }}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: cardBg,
            borderColor,
            borderWidth: checked ? 2 : 1,
            opacity: disabled ? 0.6 : pressed ? 0.9 : 1,
          },
        ]}
      >
        <View style={styles.rowTop}>
          <View
            style={[
              styles.radio,
              {
                borderColor: checked ? colors.accent : colors.outlineVariant,
              },
            ]}
          >
            {checked ? (
              <View style={[styles.radioDot, { backgroundColor: colors.accent }]} />
            ) : null}
          </View>
          <View style={styles.textCol}>
            <View style={styles.titleRow}>
              {icon ? <View style={styles.icon}>{icon}</View> : null}
              <Text
                style={[typography.body, styles.titleText, { color: colors.onSurface }]}
                numberOfLines={2}
              >
                {title}
              </Text>
              {badgeLabel && badgeTone ? (
                <View style={[styles.badge, { backgroundColor: badgeTone.backgroundColor }]}>
                  <Text style={[styles.badgeText, { color: badgeTone.color }]}>
                    {badgeLabel.toLocaleUpperCase()}
                  </Text>
                </View>
              ) : null}
            </View>
            {description ? (
              <Text
                style={[typography.caption, styles.description, { color: colors.onSurfaceVariant }]}
              >
                {description}
              </Text>
            ) : null}
          </View>
        </View>
        {footer ? (
          <View
            pointerEvents={checked ? "auto" : "none"}
            style={[styles.footer, checked ? null : styles.footerInactive]}
          >
            {footer}
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  card: {
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  radio: {
    marginTop: 2,
    width: 16,
    height: 16,
    borderRadius: radii.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 8, height: 8, borderRadius: radii.full },
  textCol: { flex: 1, gap: 6 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  icon: { flexShrink: 0, justifyContent: "center" },
  titleText: { fontWeight: "500", flexShrink: 1 },
  badge: {
    borderRadius: radii.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexShrink: 0,
    alignSelf: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "600",
    letterSpacing: 0.25,
    includeFontPadding: false,
  },
  description: {},
  footer: { marginTop: spacing.sm, gap: spacing.sm },
  footerInactive: { opacity: 0.6 },
});
