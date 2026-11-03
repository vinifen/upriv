import { Pressable, StyleSheet, View } from "react-native";
import type { MarkdownViewMode } from "@upriv/shared";
import { Icon, type IconName } from "@/components/icons";
import { useTranslation, type I18nKey } from "@/i18n";
import { useTheme } from "@/theme";
import { colorAlpha } from "@/theme/tokens";

interface MarkdownViewToggleProps {
  mode: MarkdownViewMode;
  onChange: (mode: MarkdownViewMode) => void;
}

const VIEWS: readonly { mode: MarkdownViewMode; icon: IconName; label: I18nKey }[] = [
  { mode: "source", icon: "code", label: "modal.file_manager.markdown.source" },
  { mode: "preview", icon: "eye", label: "modal.file_manager.markdown.preview" },
];

/**
 * Code and Read, each its own button: a tap on the other view picks it, and a
 * tap on the view in use switches to the other one. The view in use wears the
 * fill of the outline toggle beside it; the other is muted.
 */
export function MarkdownViewToggle({ mode, onChange }: MarkdownViewToggleProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const other: MarkdownViewMode = mode === "preview" ? "source" : "preview";
  return (
    <View accessibilityLabel={t("modal.file_manager.markdown.view")} style={styles.pair}>
      {VIEWS.map((view) => {
        const selected = view.mode === mode;
        return (
          <Pressable
            key={view.mode}
            accessibilityRole="button"
            accessibilityLabel={t(view.label)}
            accessibilityState={{ selected }}
            hitSlop={4}
            onPress={() => onChange(selected ? other : view.mode)}
            style={({ pressed }) => [
              styles.option,
              {
                backgroundColor: selected ? colors.surfaceContainerHighest : "transparent",
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Icon
              name={view.icon}
              size={14}
              color={selected ? colors.onSurface : colorAlpha(colors.onSurfaceVariant, 0.6)}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  /* The path bar's own gap, so the pair is spaced like every other button there. */
  pair: { flexDirection: "row", alignItems: "center", gap: 8 },
  option: {
    width: 24,
    height: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
});
