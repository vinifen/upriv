import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { hexWithAlpha, markdownOutline, type MarkdownOutlineEntry } from "@upriv/shared";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";

/** Path-bar button beside Code / Read: shows or hides the heading outline. */
export function MarkdownOutlineToggle({
  open,
  onChange,
}: {
  open: boolean;
  onChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(
        open
          ? "modal.file_manager.markdown.outline_hide"
          : "modal.file_manager.markdown.outline_show",
      )}
      accessibilityState={{ selected: open }}
      hitSlop={6}
      onPress={() => onChange(!open)}
      style={({ pressed }) => [
        styles.toggle,
        {
          backgroundColor: open ? colors.surfaceContainerHighest : "transparent",
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Icon name="outline" size={14} color={open ? colors.onSurface : colors.onSurfaceVariant} />
    </Pressable>
  );
}

/** Right-hand map of the note's headings, indented by nesting. Tap jumps to the heading. */
export function MarkdownOutlinePanel({
  markdown,
  activeIndex = 0,
  onSelect,
}: {
  markdown: string;
  activeIndex?: number;
  onSelect: (index: number, entry: MarkdownOutlineEntry) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const outline = useMemo(() => markdownOutline(markdown), [markdown]);
  const entries = outline.entries;
  const narrow = useWindowDimensions().width < NARROW_SCREEN_WIDTH;
  return (
    <View
      accessibilityLabel={t("modal.file_manager.markdown.outline")}
      style={[
        styles.panel,
        narrow && styles.panelNarrow,
        { backgroundColor: colors.surfaceContainerHigh, borderLeftColor: colors.outlineVariant },
      ]}
    >
      {/* Vertical drag is the outer scroller, including the gap under the rows.
          Sideways drag stays on the row list, which does not grow to fill that gap. */}
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        nestedScrollEnabled
      >
        {outline.status === "unparsed" ? (
          <Text style={[styles.empty, { color: colors.onSurfaceVariant }]}>
            {t("modal.file_manager.markdown.outline_unparsed")}
          </Text>
        ) : entries.length === 0 ? (
          <Text style={[styles.empty, { color: colors.onSurfaceVariant }]}>
            {t("modal.file_manager.markdown.outline_empty")}
          </Text>
        ) : (
          <ScrollView
            horizontal
            nestedScrollEnabled
            directionalLockEnabled
            style={styles.listRowView}
            contentContainerStyle={styles.listRow}
          >
            <View style={styles.listColumn}>
              {entries.map((entry, index) => {
                const isActive = activeIndex === index;
                return (
                  <Pressable
                    key={`${index}-${entry.offset}`}
                    accessibilityRole="button"
                    accessibilityLabel={entry.text}
                    accessibilityState={{ selected: isActive }}
                    onPress={() => onSelect(index, entry)}
                    style={({ pressed }) => [
                      styles.entry,
                      {
                        paddingLeft: 12 + entry.level * 12,
                        borderLeftWidth: 2,
                        borderLeftColor: isActive ? colors.accent : "transparent",
                        backgroundColor: isActive
                          ? hexWithAlpha(colors.accent, 0.1)
                          : "transparent",
                        opacity: pressed ? 0.6 : 1,
                      },
                    ]}
                  >
                    <Text
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      style={[
                        styles.entryText,
                        isActive
                          ? { color: colors.accent, fontWeight: "600" }
                          : entry.level === 0
                            ? { color: colors.onSurface, fontWeight: "600" }
                            : { color: colors.onSurfaceVariant },
                      ]}
                    >
                      {entry.text || "…"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        )}
      </ScrollView>
    </View>
  );
}

/** Below this window width (most phones in portrait) the outline gets a slimmer column. */
const NARROW_SCREEN_WIDTH = 480;

const styles = StyleSheet.create({
  toggle: {
    width: 24,
    height: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  panel: {
    width: "34%",
    maxWidth: 190,
    minHeight: 0,
    flexShrink: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  panelNarrow: { width: "32%", maxWidth: 165 },
  empty: { paddingHorizontal: 12, paddingVertical: 8, fontSize: 12 },
  list: { flex: 1, minHeight: 0 },
  /* flexGrow: content fills the panel, so empty space below the entries still drags. */
  listContent: { flexGrow: 1, paddingVertical: 4 },
  /* No flexGrow: the empty space under the rows stays on the vertical scroller. */
  listRowView: { flexGrow: 0 },
  listRow: { flexGrow: 1 },
  listColumn: { flexGrow: 1 },
  entry: { paddingRight: 12, paddingVertical: 4 },
  /* Sideways scroll for indent + normal titles; very long titles still truncate. */
  entryText: { fontSize: 12, lineHeight: 18, maxWidth: 256 },
});
