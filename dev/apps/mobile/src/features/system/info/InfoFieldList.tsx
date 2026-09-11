import { StyleSheet, Text, View } from "react-native";
import type { InfoField } from "@upriv/shared";
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
          <Text selectable style={[typography.mono, styles.value, { color: colors.onSurface }]}>
            {field.value}
          </Text>
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
  value: {
    flexShrink: 1,
  },
});
