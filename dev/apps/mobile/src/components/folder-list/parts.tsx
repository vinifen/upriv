import type { ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Button, DropdownPanel, IconButton } from "@/components/ui";
import { useTranslation, type I18nKey } from "@/i18n";
import { useTheme, type ThemeColors } from "@/theme";
import { colorAlpha, radii, spacing } from "@/theme/tokens";

/** Radio (16) and its gap (12): where what belongs to a row starts under it. */
export const ROW_INSET = 16 + spacing.md;

/**
 * A choice's card, `PolicyRadioOption` parity: the attention border while it
 * misses a step, else the accent when chosen; dimmed while the list is locked.
 */
export function rowCardStyle(
  colors: ThemeColors,
  checked: boolean,
  attention: boolean,
  locked: boolean,
): StyleProp<ViewStyle> {
  return [
    styles.card,
    {
      backgroundColor: colors.surfaceContainer,
      borderColor: attention
        ? colors.vaultStatusRecovery
        : checked
          ? colors.accent
          : colors.outlineVariant,
      borderWidth: attention || checked ? 2 : 1,
      opacity: locked ? 0.6 : 1,
    },
  ];
}

/** This device's radio: a ring, filled with a dot when chosen. */
export function RadioMark({ checked }: { checked: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.radio, { borderColor: checked ? colors.accent : colors.outlineVariant }]}>
      {checked ? <View style={[styles.radioDot, { backgroundColor: colors.accent }]} /> : null}
    </View>
  );
}

type BadgeKind = "in_use" | "unsaved" | "selected_there";

const BADGE_KEYS: Record<BadgeKind, I18nKey> = {
  in_use: "folder_list.badge.in_use",
  unsaved: "folder_list.badge.unsaved",
  selected_there: "folder_list.badge.selected_there",
};

function badgeColors(kind: BadgeKind, colors: ThemeColors) {
  switch (kind) {
    case "in_use":
      return {
        backgroundColor: colorAlpha(colors.vaultStatusOpen, 0.2),
        color: colors.vaultStatusOpen,
      };
    case "unsaved":
      return { backgroundColor: colorAlpha(colors.accent, 0.18), color: colors.accent };
    case "selected_there":
      return { backgroundColor: colors.surfaceContainerHighest, color: colors.onSurfaceVariant };
  }
}

/**
 * A word beside a choice's name (desktop `ListBadge` parity): In use, Not
 * saved, or Chosen there.
 */
export function ListBadge({ kind }: { kind: BadgeKind }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const tone = badgeColors(kind, colors);
  return (
    <View style={[styles.badge, { backgroundColor: tone.backgroundColor }]}>
      <Text style={[styles.badgeText, { color: tone.color }]}>
        {t(BADGE_KEYS[kind]).toLocaleUpperCase()}
      </Text>
    </View>
  );
}

/** This device's heading in a list: what it is to the list, and its name (`deviceName`). */
export function DeviceHeading({ heading, name }: { heading: string; name: string }) {
  const { colors, typography } = useTheme();
  return (
    <View style={styles.deviceHeading}>
      <Text style={[typography.caption, styles.overline, { color: colors.onSurfaceVariant }]}>
        {heading.toLocaleUpperCase()}
      </Text>
      <Text style={[typography.body, styles.strong, { color: colors.onSurface }]}>{name}</Text>
    </View>
  );
}

/** A small uppercase heading over part of a list (Other devices). */
export function ListOverline({ children }: { children: string }) {
  const { colors, typography } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={[typography.caption, styles.overline, { color: colors.onSurfaceVariant }]}
    >
      {children.toLocaleUpperCase()}
    </Text>
  );
}

/**
 * What a choice says (desktop `RowText` parity): its name with its badges, a
 * description, its folder as a list shows it, then any lines under them (a
 * problem, a status).
 */
export function RowText({
  title,
  badges,
  description,
  folder,
  children,
}: {
  title: string;
  badges?: ReactNode;
  description?: string;
  folder?: string | null;
  children?: ReactNode;
}) {
  const { colors, typography } = useTheme();
  return (
    <View style={styles.text}>
      <View style={styles.titleRow}>
        <Text style={[typography.body, styles.strong, styles.title, { color: colors.onSurface }]}>
          {title}
        </Text>
        {badges}
      </View>
      {description ? (
        <Text style={[typography.caption, { color: colors.onSurfaceVariant }]}>{description}</Text>
      ) : null}
      {folder ? (
        <Text style={[typography.mono, { color: colors.onSurfaceVariant }]}>{folder}</Text>
      ) : null}
      {children}
    </View>
  );
}

/**
 * A row's actions, behind one ⋯ at its end (desktop `RowMenu` parity):
 * outside the row's radio, so none of them selects it. The button sits in
 * the middle of the row's height and keeps a full touch target.
 */
export function RowMenu({ name, children }: { name: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <DropdownPanel
      label={name}
      heading={name}
      align="right"
      minWidth={220}
      trigger={
        <IconButton
          label={t("action.row_options", { name })}
          icon="more-horizontal"
          size={18}
          style={styles.menuTrigger}
        />
      }
    >
      {children}
    </DropdownPanel>
  );
}

/** A question a row asks before it goes, under it, with Cancel and its confirm. */
export function RowConfirm({
  question,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  return (
    <View style={[styles.below, { borderTopColor: colors.outlineVariant }]}>
      <Text accessibilityRole="alert" style={[typography.caption, { color: colors.onSurface }]}>
        {question}
      </Text>
      <View style={styles.actions}>
        <Button label={t("action.cancel")} size="sm" variant="ghost" onPress={onCancel} />
        <Button label={confirmLabel} size="sm" variant="danger" onPress={onConfirm} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
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
  badge: {
    borderRadius: radii.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexShrink: 0,
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "600",
    letterSpacing: 0.25,
    includeFontPadding: false,
  },
  deviceHeading: { gap: 2 },
  overline: { fontWeight: "600", letterSpacing: 0.5 },
  strong: { fontWeight: "500" },
  text: { flex: 1, minWidth: 0, gap: 2 },
  titleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: spacing.sm,
    rowGap: spacing.xs,
  },
  title: { flexShrink: 1 },
  // 40 pt to touch, taking no height of its own: a one-line row stays as tall.
  menuTrigger: { marginTop: -10, marginBottom: -10, marginRight: -spacing.sm },
  below: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
});
