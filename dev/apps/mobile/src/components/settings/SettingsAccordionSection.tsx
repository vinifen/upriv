import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { GROUP_COLLAPSE_MS, GROUP_EXPAND_MS } from "@upriv/shared";
import { Icon } from "@/components/icons";
import { Collapse } from "@/components/ui/Collapse";
import { useTheme } from "@/theme";
import { radii, settingsSectionBoxShadow, spacing } from "@/theme/tokens";

interface SettingsAccordionSectionProps {
  title: string;
  defaultOpen?: boolean;
  /** When set, expansion is controlled by the parent (desktop `VaultSettingsSection` parity). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  tone?: "default" | "danger";
  /** End of the header, outside the expand control, so its controls never toggle the section. */
  aside?: ReactNode;
  children: ReactNode;
}

function SectionChevron({ open, color }: { open: boolean; color: string }) {
  const rotation = useRef(new Animated.Value(open ? 0 : 1)).current;

  useEffect(() => {
    Animated.timing(rotation, {
      toValue: open ? 0 : 1,
      duration: open ? GROUP_EXPAND_MS : GROUP_COLLAPSE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open, rotation]);

  const rotate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "-90deg"],
  });

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Icon name="chevron-down" size={18} color={color} />
    </Animated.View>
  );
}

/** Accordion card matching desktop `VaultSettingsSection` / app-settings sections. */
export function SettingsAccordionSection({
  title,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  tone = "default",
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
          <SectionChevron
            open={open}
            color={tone === "danger" ? colors.onErrorContainer : colors.onSurfaceVariant}
          />
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
