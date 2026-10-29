import { Pressable, StyleSheet, View } from "react-native";
import type { MarkdownViewMode } from "@upriv/shared";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { colorAlpha } from "@/theme/tokens";

interface MarkdownViewToggleProps {
  mode: MarkdownViewMode;
  onChange: (mode: MarkdownViewMode) => void;
}

/** Vault-wide Code / Read control. The choice is stored on the workspace file. */
export function MarkdownViewToggle({ mode, onChange }: MarkdownViewToggleProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const isPreview = mode === "preview";
  const nextMode: MarkdownViewMode = isPreview ? "source" : "preview";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("modal.file_manager.markdown.view")}
      accessibilityState={{ selected: isPreview }}
      onPress={() => onChange(nextMode)}
      style={[
        styles.bar,
        {
          borderColor: colors.outlineVariant,
          backgroundColor: colors.surfaceContainerHighest + "4D",
        },
      ]}
    >
      <View
        style={[
          styles.option,
          {
            backgroundColor: mode === "source" ? colors.surfaceContainerHighest : "transparent",
          },
        ]}
      >
        <Icon
          name="code"
          size={13}
          color={mode === "source" ? colors.onSurface : colorAlpha(colors.onSurfaceVariant, 0.5)}
        />
      </View>
      <View
        style={[
          styles.option,
          {
            backgroundColor: mode === "preview" ? colors.surfaceContainerHighest : "transparent",
          },
        ]}
      >
        <Icon
          name="eye"
          size={13}
          color={mode === "preview" ? colors.onSurface : colorAlpha(colors.onSurfaceVariant, 0.5)}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    height: 24,
    borderRadius: 6,
    borderWidth: 1,
    padding: 2,
    gap: 2,
  },
  option: {
    width: 20,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
  },
});
