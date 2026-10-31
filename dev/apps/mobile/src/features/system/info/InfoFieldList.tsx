import { Linking, StyleSheet, Text, View } from "react-native";
import type { InfoField } from "@upriv/shared";
import { RevealPathButton } from "@/components/RevealPathButton";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";

interface InfoFieldListProps {
  fields: InfoField[];
}

export function InfoFieldList({ fields }: InfoFieldListProps) {
  const { colors, typography } = useTheme();

  return (
    <View style={styles.list}>
      {fields.map((field) => (
        <View key={field.id} style={styles.row}>
          <Text style={[typography.caption, styles.label, { color: colors.onSurfaceVariant }]}>
            {field.label}
          </Text>
          <View style={styles.valueRow}>
            <Text
              selectable
              accessibilityRole={field.href ? "link" : "text"}
              onPress={
                field.href
                  ? () => {
                      void Linking.openURL(field.href ?? "");
                    }
                  : undefined
              }
              style={[
                typography.mono,
                styles.value,
                { color: colors.onSurface },
                field.href ? styles.link : undefined,
              ]}
            >
              {field.value}
            </Text>
            {/* The app home is private app storage: the Files app cannot open it. */}
            {field.id === "app_home" ? null : <RevealPathButton path={field.openPath} />}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  row: {
    gap: 2,
  },
  label: {
    textTransform: "none",
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  value: {
    flex: 1,
    flexShrink: 1,
  },
  link: {
    textDecorationLine: "underline",
  },
});
