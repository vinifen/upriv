import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MarkdownViewMode } from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";

interface MarkdownViewToggleProps {
  mode: MarkdownViewMode;
  onChange: (mode: MarkdownViewMode) => void;
}

const OPTIONS: MarkdownViewMode[] = ["source", "preview"];

/** Vault-wide Code / Read control. The choice is stored on the workspace file. */
export function MarkdownViewToggle({ mode, onChange }: MarkdownViewToggleProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t("modal.file_manager.markdown.view")}
      style={styles.bar}
    >
      {OPTIONS.map((option) => {
        const selected = mode === option;
        const label =
          option === "preview"
            ? t("modal.file_manager.markdown.preview")
            : t("modal.file_manager.markdown.source");
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option)}
            style={[
              styles.option,
              {
                backgroundColor: selected ? colors.surfaceContainerHighest : "transparent",
              },
            ]}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: "600",
                color: selected ? colors.onSurface : colors.onSurfaceVariant,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  option: {
    minWidth: 68,
    alignItems: "center",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 2,
  },
});
