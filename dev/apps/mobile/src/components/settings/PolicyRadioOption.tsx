import { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  mixHex,
  POLICY_RADIO_BADGE_I18N,
  policyRadioBadgeList,
  type PolicyRadioBadge,
} from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { useTheme, type ThemeColors } from "@/theme";
import { colorAlpha, radii, spacing } from "@/theme/tokens";

type Tone = "default" | "less-secure" | "insecure";

/** How far the error color goes into the card, per risk tone. */
const TONE_ERROR_MIX: Record<Tone, number> = {
  default: 0,
  "less-secure": 0.07,
  insecure: 0.14,
};

interface PolicyRadioOptionProps {
  value: string;
  checked: boolean;
  title: string;
  /** Optional leading icon (sits before the title). */
  icon?: ReactNode;
  description?: string;
  disabled?: boolean;
  /** Gray, still selectable. The file manager folder inside can stay locked. */
  muted?: boolean;
  /** One badge, or several shown in this order. */
  badge?: PolicyRadioBadge | readonly PolicyRadioBadge[];
  tone?: Tone;
  /**
   * Yellow/amber border while this option still needs follow-up config
   * (e.g. vault-root incomplete policy). Overrides the accent border when checked.
   */
  attention?: boolean;
  /**
   * The option's own controls under the description. Pass them whether or not
   * the option is chosen: they always show, inactive until it is, and a tap
   * on them chooses the option.
   */
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
    case "in-use":
      return {
        backgroundColor: colorAlpha(colors.vaultStatusOpen, 0.2),
        color: colors.vaultStatusOpen,
      };
    case "less-secure":
    case "not-recommended":
      return {
        backgroundColor: colorAlpha(colors.onErrorContainer, 0.15),
        color: colors.onErrorContainer,
      };
    case "insecure":
      return {
        backgroundColor: colorAlpha(colors.onErrorContainer, 0.25),
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
  muted = false,
  badge,
  tone = "default",
  attention = false,
  footer,
  onSelect,
  accessibilityLabel,
}: PolicyRadioOptionProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();

  const insecure = tone === "insecure";

  const borderColor = checked
    ? attention
      ? colors.vaultStatusRecovery
      : insecure
        ? colors.dangerBorder
        : colors.accent
    : insecure
      ? colors.dangerBorder
      : colors.outlineVariant;

  const cardBg =
    tone === "default"
      ? colors.surfaceContainer
      : mixHex(colors.surfaceContainer, colors.errorContainer, TONE_ERROR_MIX[tone]);

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: cardBg,
            borderColor,
            borderWidth: checked ? 2 : 1,
            opacity: disabled || muted ? 0.6 : 1,
          },
        ]}
      >
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
          style={({ pressed }) => [pressed && !disabled ? { opacity: 0.9 } : null]}
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
                {policyRadioBadgeList(badge).map((item) => {
                  const tone = policyRadioBadgeColors(item, colors);
                  return (
                    <View
                      key={item}
                      style={[styles.badge, { backgroundColor: tone.backgroundColor }]}
                    >
                      <Text style={[styles.badgeText, { color: tone.color }]}>
                        {t(POLICY_RADIO_BADGE_I18N[item]).toLocaleUpperCase()}
                      </Text>
                    </View>
                  );
                })}
              </View>
              {description ? (
                <Text
                  style={[
                    typography.caption,
                    styles.description,
                    { color: colors.onSurfaceVariant },
                  ]}
                >
                  {description}
                </Text>
              ) : null}
            </View>
          </View>
        </Pressable>
        {footer ? (
          checked ? (
            <View style={styles.footer}>{footer}</View>
          ) : (
            <Pressable
              onPress={() => {
                if (disabled) return;
                onSelect();
              }}
              disabled={disabled}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.footer, styles.footerInactive]}
            >
              <View pointerEvents="none">{footer}</View>
            </Pressable>
          )
        ) : null}
      </View>
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
