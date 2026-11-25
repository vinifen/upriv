import { Animated, Linking, StyleSheet, Text, View } from "react-native";
import type { InfoField } from "@upriv/shared";
import { RevealPathButton } from "@/components/RevealPathButton";
import { usePulseOpacity } from "@/hooks/usePulseOpacity";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { colorAlpha, spacing } from "@/theme/tokens";

interface InfoFieldListProps {
  fields: InfoField[];
}

/** Label and value rows (desktop parity); a value still being read shows a skeleton bar. */
export function InfoFieldList({ fields }: InfoFieldListProps) {
  const { colors, typography } = useTheme();
  const { t } = useTranslation();
  const pulse = usePulseOpacity();

  return (
    <View style={styles.list}>
      {fields.map((field) => (
        <View key={field.id} style={styles.row}>
          <Text style={[typography.caption, styles.label, { color: colors.onSurfaceVariant }]}>
            {field.label}
          </Text>
          {field.loading ? (
            <Animated.View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={t("modal.info.loading")}
              style={[
                styles.skeleton,
                {
                  backgroundColor: colorAlpha(colors.onSurfaceVariant, 0.22),
                  opacity: pulse,
                },
              ]}
            />
          ) : (
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
          )}
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
  skeleton: {
    width: "40%",
    height: 12,
    marginTop: 4,
    borderRadius: 4,
  },
});
