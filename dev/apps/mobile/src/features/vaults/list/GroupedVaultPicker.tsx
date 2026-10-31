import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  buildGroupedVaultPickerItems,
  GROUPED_VAULT_PICKER_VISIBLE_ROWS,
  type VaultGroup,
  type VaultListItem,
} from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { ThemedInput } from "@/components/settings";
import { Checkbox } from "@/components/ui";
import { radii, spacing } from "@/theme/tokens";

interface GroupedVaultPickerProps {
  vaults: VaultListItem[];
  groups: VaultGroup[];
  excludeGroupId?: string;
  selectedIds: string[];
  onToggle: (vaultId: string) => void;
  disabled?: boolean;
  includeHidden?: boolean;
}

const ROW_HEIGHT = 36;
/** Six rows, then the list scrolls. */
const LIST_MAX_HEIGHT = GROUPED_VAULT_PICKER_VISIBLE_ROWS * ROW_HEIGHT;

/**
 * Vault multi-select of checkboxes (nested ScrollView, not FlatList, for the
 * Modal body). Past six vaults it scrolls and gains a search field.
 */
export function GroupedVaultPicker({
  vaults,
  groups,
  excludeGroupId,
  selectedIds,
  onToggle,
  disabled = false,
  includeHidden = false,
}: GroupedVaultPickerProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const [query, setQuery] = useState("");

  const allItems = useMemo(
    () => buildGroupedVaultPickerItems({ vaults, groups, excludeGroupId, includeHidden }),
    [excludeGroupId, groups, includeHidden, vaults],
  );
  const searchable = allItems.length > GROUPED_VAULT_PICKER_VISIBLE_ROWS;
  // A list short enough to show whole has no search, and drops what was typed.
  const activeQuery = searchable ? query : "";
  useEffect(() => {
    if (!searchable) setQuery("");
  }, [searchable]);
  const items = useMemo(
    () =>
      activeQuery.trim()
        ? buildGroupedVaultPickerItems({
            vaults,
            groups,
            excludeGroupId,
            query: activeQuery,
            includeHidden,
          })
        : allItems,
    [activeQuery, allItems, excludeGroupId, groups, includeHidden, vaults],
  );

  if (allItems.length === 0) {
    return <Text style={typography.bodyMuted}>{t("vault.group.create.grouped_vaults_empty")}</Text>;
  }

  return (
    <View style={styles.root}>
      {searchable ? (
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
      ) : null}

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
          style={styles.list}
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
                <Checkbox checked={checked} interactive={false} />
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
  list: {
    maxHeight: LIST_MAX_HEIGHT,
    flexGrow: 0,
    flexShrink: 1,
  },
  search: {
    borderRadius: radii.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  row: {
    minHeight: ROW_HEIGHT,
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radii.sm,
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
