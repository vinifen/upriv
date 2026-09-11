import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/icons";
import { useTheme } from "@/theme";
import { radii, settingsSectionBoxShadow, spacing } from "@/theme/tokens";

interface SettingsAccordionSectionProps {
  title: string;
  defaultOpen?: boolean;
  /** When set, expansion is controlled by the parent (desktop `VaultSettingsSection` parity). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  tone?: "default" | "danger";
  children: ReactNode;
}

/** Accordion card matching desktop `VaultSettingsSection` / app-settings sections. */
export function SettingsAccordionSection({
  title,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  tone = "default",
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
      <Pressable
        onPress={toggle}
        style={styles.header}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={{ transform: [{ rotate: open ? "0deg" : "-90deg" }] }}>
          <Icon
            name="chevron-down"
            size={18}
            color={tone === "danger" ? colors.onErrorContainer : colors.onSurfaceVariant}
          />
        </View>
        <Text
          style={[
            typography.caption,
            styles.title,
            { color: tone === "danger" ? colors.onErrorContainer : colors.onSurface },
          ]}
        >
          {title}
        </Text>
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.md,
    overflow: "visible",
  },
  header: {
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
  body: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
});
