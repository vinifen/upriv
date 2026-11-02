import { Pressable, StyleSheet, View } from "react-native";
import type { MarkdownViewMode } from "@upriv/shared";
import { Icon, type IconName } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { radii } from "@/theme/tokens";

interface MarkdownViewToggleProps {
  mode: MarkdownViewMode;
  onChange: (mode: MarkdownViewMode) => void;
}

/** Vault-wide Code / Read control. The choice is stored on the workspace file. */
export function MarkdownViewToggle({ mode, onChange }: MarkdownViewToggleProps) {
  const { t } = useTranslation();
  const isPreview = mode === "preview";
  const nextMode: MarkdownViewMode = isPreview ? "source" : "preview";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("modal.file_manager.markdown.view")}
      accessibilityState={{ selected: isPreview }}
      hitSlop={6}
      onPress={() => onChange(nextMode)}
      style={({ pressed }) => [styles.bar, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Segment icon="code" active={mode === "source"} />
      <Segment icon="eye" active={isPreview} />
    </Pressable>
  );
}

/** Same fills as the outline toggle beside it. */
function Segment({ icon, active }: { icon: IconName; active: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.option,
        { backgroundColor: active ? colors.surfaceContainerHighest : "transparent" },
      ]}
    >
      <Icon name={icon} size={13} color={active ? colors.onSurface : colors.onSurfaceVariant} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    height: 24,
    borderRadius: radii.full,
    padding: 2,
    gap: 2,
  },
  option: {
    width: 20,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
  },
});
