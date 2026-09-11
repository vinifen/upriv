import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { buildGroupedVaultPickerItems, type VaultGroup, type VaultListItem } from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { ThemedInput } from "@/components/settings";
import { MODAL_MAX_HEIGHT_RATIO, radii, spacing } from "@/theme/tokens";

interface GroupedVaultPickerProps {
  vaults: VaultListItem[];
  groups: VaultGroup[];
  excludeGroupId?: string;
  selectedIds: string[];
  onToggle: (vaultId: string) => void;
  disabled?: boolean;
  includeHidden?: boolean;
  /**
   * List fills leftover modal height and is the only scroll pane.
   * Use in create-group (`bodyScroll={false}`).
   */
  fill?: boolean;
}

const LIST_MAX_HEIGHT = 320;
const CREATE_GROUP_CHROME =
  52 /* title */ + 72 /* footer */ + 220; /* name + help + search + count */

/** Searchable vault multi-select (nested ScrollView — not FlatList, for Modal body). */
export function GroupedVaultPicker({
  vaults,
  groups,
  excludeGroupId,
  selectedIds,
  onToggle,
  disabled = false,
  includeHidden = false,
  fill = false,
}: GroupedVaultPickerProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const [query, setQuery] = useState("");
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const listMaxHeight = useMemo(() => {
    const framePadTop = Math.max(insets.top, spacing.md);
    const framePadBottom = Math.max(insets.bottom, spacing.md);
    const dialogMaxHeight = Math.max(
      240,
      Math.round(windowHeight * MODAL_MAX_HEIGHT_RATIO) - framePadTop - framePadBottom,
    );
    if (fill) {
      return Math.max(140, dialogMaxHeight - CREATE_GROUP_CHROME);
    }
    return Math.min(LIST_MAX_HEIGHT, Math.max(140, Math.round(windowHeight * 0.28)));
  }, [fill, insets.bottom, insets.top, windowHeight]);

  const items = useMemo(
    () =>
      buildGroupedVaultPickerItems({
        vaults,
        groups,
        excludeGroupId,
        query,
        includeHidden,
      }),
    [excludeGroupId, groups, includeHidden, query, vaults],
  );

  if (items.length === 0 && !query.trim()) {
    return <Text style={typography.bodyMuted}>{t("vault.group.create.grouped_vaults_empty")}</Text>;
  }

  return (
    <View style={[styles.root, fill ? styles.rootFill : null]}>
      <ThemedInput
        value={query}
        editable={!disabled}
        onChangeText={setQuery}
        placeholder={t("vault.group.picker.search")}
        autoCorrect={false}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        blurOnSubmit={false}
        style={styles.search}
      />

      <Text style={typography.caption}>
        {t("vault.group.picker.count", {
          selected: String(selectedIds.length),
          total: String(items.length),
        })}
      </Text>

      {items.length === 0 ? (
        <Text style={typography.bodyMuted}>{t("vault.group.picker.search_empty")}</Text>
      ) : (
        <ScrollView
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          style={{ maxHeight: listMaxHeight, flexGrow: 0, flexShrink: 1 }}
          showsVerticalScrollIndicator
          bounces={false}
        >
          {items.map((item) => {
            const checked = selectedIds.includes(item.vault.id);
            const label = item.otherGroup
              ? `${item.vault.displayName} · ${t("vault.group.create.in_group", {
                  group: item.otherGroup.displayName,
                })}`
              : item.vault.displayName;
            return (
              <Pressable
                key={item.vault.id}
                disabled={disabled}
                onPress={() => onToggle(item.vault.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked, disabled }}
                accessibilityLabel={label}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: pressed ? colors.surfaceRowHover : "transparent",
                    opacity: disabled ? 0.6 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: checked ? colors.accent : colors.outlineVariant,
                      backgroundColor: checked ? colors.accent : colors.surfaceContainerHigh,
                    },
                  ]}
                >
                  {checked ? (
                    <Svg width={10} height={10} viewBox="0 0 16 16">
                      <Path
                        d="M3.2 8.2 6.5 11.4 12.8 4.6"
                        fill="none"
                        stroke={colors.accentForeground}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                  ) : null}
                </View>
                <Text style={[typography.body, styles.rowLabel]} numberOfLines={1}>
                  {item.vault.displayName}
                </Text>
                {item.otherGroup ? (
                  <Text style={[typography.mono, styles.inGroup]} numberOfLines={1}>
                    {t("vault.group.create.in_group", { group: item.otherGroup.displayName })}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.sm,
  },
  rootFill: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
  },
  search: {
    borderRadius: radii.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  row: {
    minHeight: 36,
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radii.sm,
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: radii.xs,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
  },
  inGroup: {
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    flexShrink: 0,
  },
});
