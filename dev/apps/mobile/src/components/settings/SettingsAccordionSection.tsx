import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Collapse } from "@/components/ui/Collapse";
import { DisclosureChevron } from "@/components/ui/DisclosureChevron";
import { useTheme } from "@/theme";
import { radii, settingsSectionBoxShadow, spacing } from "@/theme/tokens";

interface SettingsAccordionSectionProps {
  title: string;
  defaultOpen?: boolean;
  /** When set, expansion is controlled by the parent (desktop `VaultSettingsSection` parity). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** End of the header, outside the expand control, so its controls never toggle the section. */
  aside?: ReactNode;
  children: ReactNode;
}

/** Accordion card matching desktop `VaultSettingsSection` / app-settings sections. */
export function SettingsAccordionSection({
  title,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  aside,
  children,
}: SettingsAccordionSectionProps) {
  const { colors, typography, theme } = useTheme();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;

  const toggle = () => {
    const next = !open;
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surfaceContainer,
          // Soft desktop-shaped shadow; opacity bumped for mobile only (see tokens).
          boxShadow: settingsSectionBoxShadow(theme),
        },
      ]}
    >
      <View style={styles.headerRow}>
        <Pressable
          onPress={toggle}
          style={styles.header}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
        >
          <DisclosureChevron open={open} color={colors.onSurfaceVariant} />
          <Text style={[typography.caption, styles.title, { color: colors.onSurface }]}>
            {title}
          </Text>
        </Pressable>
        {aside ? <View style={styles.aside}>{aside}</View> : null}
      </View>
      <Collapse open={open}>
        <View style={styles.body}>{children}</View>
      </Collapse>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.md,
    overflow: "visible",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  header: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  title: {
    flex: 1,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    fontWeight: "600",
  },
  aside: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingRight: spacing.md,
  },
  body: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
});
