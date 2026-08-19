import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/icons";
import { useTheme } from "@/theme";
import { radii, spacing } from "@/theme/tokens";

interface SettingsAccordionSectionProps {
  title: string;
  defaultOpen?: boolean;
  tone?: "default" | "danger";
  children: ReactNode;
}

/** Accordion card matching desktop `VaultSettingsSection` / app-settings sections. */
export function SettingsAccordionSection({
  title,
  defaultOpen = false,
  tone = "default",
  children,
}: SettingsAccordionSectionProps) {
  const { colors, typography } = useTheme();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surfaceContainer,
          borderColor: colors.outlineVariant,
        },
      ]}
    >
      <Pressable
        onPress={() => setOpen((current) => !current)}
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
    borderWidth: 1,
    overflow: "hidden",
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
