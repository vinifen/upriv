import { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { radii, spacing } from "@/theme/tokens";

type Badge = "recommended" | "less-secure" | "insecure" | "default" | "more-secure";
type Tone = "default" | "less-secure" | "insecure";

interface PolicyRadioOptionProps {
  value: string;
  checked: boolean;
  title: string;
  description: string;
  disabled?: boolean;
  badge?: Badge;
  tone?: Tone;
  /**
   * Yellow/amber border while this option still needs follow-up config
   * (e.g. vault-root incomplete policy). Overrides the accent border when checked.
   */
  attention?: boolean;
  /** Shown below the description while this option is selected. */
  footer?: ReactNode;
  onSelect: () => void;
  accessibilityLabel?: string;
}

/**
 * RN parity for the desktop `PolicyRadioOption`.
 *
 * Card-styled radio: shown checked with an accent border; while `attention` is
 * true (unresolved incomplete-replace policy), an amber border overrides so
 * the user can see which option still needs a follow-up choice.
 */
export function PolicyRadioOption({
  value,
  checked,
  title,
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

  const borderColor = attention
    ? colors.vaultStatusRecovery
    : checked
      ? colors.accent
      : isInsecure || isLessSecure
        ? colors.errorContainer
        : colors.outlineVariant;

  const cardBg = isInsecure
    ? mix(colors.surfaceContainer, colors.errorContainer, 0.18)
    : isLessSecure
      ? mix(colors.surfaceContainer, colors.errorContainer, 0.07)
      : colors.surfaceContainer;

  const badgeLabel = badge
    ? t(
        `modal.settings.badge.${
          badge === "less-secure"
            ? "less_secure"
            : badge === "more-secure"
              ? "more_secure"
              : badge
        }` as `modal.settings.badge.${"recommended" | "default" | "less_secure" | "insecure" | "more_secure"}`,
      )
    : null;

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
            borderWidth: checked || attention ? 2 : 1,
            opacity: disabled ? 0.5 : pressed ? 0.9 : 1,
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
              <Text style={[typography.body, styles.titleText]} numberOfLines={2}>
                {title}
              </Text>
              {badgeLabel ? (
                <Text
                  style={[
                    typography.caption,
                    styles.badge,
                    {
                      color:
                        badge === "less-secure" || badge === "insecure"
                          ? colors.onErrorContainer
                          : badge === "more-secure"
                            ? colors.vaultStatusOpen
                            : colors.onSurfaceVariant,
                      borderColor:
                        badge === "less-secure" || badge === "insecure"
                          ? colors.errorContainer
                          : badge === "more-secure"
                            ? colors.vaultStatusOpen
                            : colors.outlineVariant,
                    },
                  ]}
                >
                  {badgeLabel}
                </Text>
              ) : null}
            </View>
            <Text style={[typography.caption, styles.description]}>{description}</Text>
          </View>
        </View>
        {checked && footer ? <View style={styles.footer}>{footer}</View> : null}
      </Pressable>
    </View>
  );
}

/**
 * Approximate CSS `color-mix(in srgb, a X%, b)` for two hex colors.
 * Returns `b` when parsing fails (safe fallback).
 */
function mix(base: string, tint: string, tintRatio: number): string {
  const b = hexToRgb(base);
  const tr = hexToRgb(tint);
  if (!b || !tr) return base;
  const r = Math.round(b.r * (1 - tintRatio) + tr.r * tintRatio);
  const g = Math.round(b.g * (1 - tintRatio) + tr.g * tintRatio);
  const bl = Math.round(b.b * (1 - tintRatio) + tr.b * tintRatio);
  return `rgb(${r}, ${g}, ${bl})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.replace("#", "").trim();
  if (cleaned.length !== 6) return null;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return { r, g, b };
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
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  textCol: { flex: 1, gap: 4 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  titleText: { fontWeight: "600", flexShrink: 1 },
  badge: {
    borderRadius: radii.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    overflow: "hidden",
  },
  description: {},
  footer: { marginTop: spacing.sm, gap: spacing.sm },
});
