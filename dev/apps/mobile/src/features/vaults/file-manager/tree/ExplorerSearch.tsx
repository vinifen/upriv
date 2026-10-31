import type { RefObject } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Icon } from "@/components/icons";
import { IconButton } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { radii } from "@/theme/tokens";

/** The explorer toolbar's button that opens and closes the search bar. */
export function ExplorerSearchToggle({
  open,
  atWork,
  onToggle,
}: {
  open: boolean;
  /** The bar is closed and its search still filters the explorer. */
  atWork: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const iconColor = open ? colors.onSurface : atWork ? colors.accent : colors.onSurfaceVariant;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(
        atWork
          ? "modal.file_manager.explorer.search_toggle_active"
          : "modal.file_manager.explorer.search_toggle",
      )}
      accessibilityState={{ selected: open }}
      hitSlop={8}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.toggle,
        {
          backgroundColor: open ? colors.surfaceContainerHighest : "transparent",
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Icon name="search" size={14} color={iconColor} />
    </Pressable>
  );
}

interface ExplorerSearchProps {
  inputRef: RefObject<TextInput>;
  query: string;
  onQueryChange: (query: string) => void;
}

/** Finds files and folders by name, at any depth of the vault. */
export function ExplorerSearch({ inputRef, query, onQueryChange }: ExplorerSearchProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={[styles.field, { backgroundColor: colors.surfaceContainerHighest }]}>
      <Icon name="search" size={12} color={colors.onSurfaceVariant} />
      <TextInput
        ref={inputRef}
        value={query}
        onChangeText={onQueryChange}
        returnKeyType="search"
        placeholder={t("modal.file_manager.explorer.search_placeholder")}
        placeholderTextColor={colors.onSurfaceVariant}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        accessibilityLabel={t("modal.file_manager.explorer.search_placeholder")}
        style={[styles.input, { color: colors.onSurface }]}
      />
      {query ? (
        <IconButton
          label={t("modal.file_manager.explorer.search_clear")}
          icon="close"
          size={11}
          tone="muted"
          onPress={() => onQueryChange("")}
          style={styles.clear}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    height: 28,
    gap: 4,
    marginHorizontal: 4,
    marginBottom: 4,
    paddingHorizontal: 6,
    borderRadius: radii.sm,
  },
  input: { flex: 1, minWidth: 0, paddingVertical: 0, fontSize: 12 },
  clear: { width: 22, height: 22 },
});
