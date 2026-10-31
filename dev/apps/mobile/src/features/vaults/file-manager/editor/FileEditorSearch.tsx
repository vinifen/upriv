import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { pointInHitRect } from "@upriv/shared";
import { Icon, type IconName } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { radii } from "@/theme/tokens";
import { measurePageRect } from "../lib/measurePageRect";

export interface FileEditorSearchHandle {
  /** A touch landed at this page point: leave the field when it is outside it. */
  blurIfOutside: (pageX: number, pageY: number) => void;
}

export interface FileEditorSearchProps {
  query: string;
  totalMatches: number;
  activeMatchIndex: number;
  onQueryChange: (query: string) => void;
  onNextMatch: () => void;
  onPrevMatch: () => void;
}

/** Widest the field gets; the path beside it gives up its width first. */
const SEARCH_MAX_WIDTH = 176;
const SEARCH_MIN_WIDTH = 120;

function SearchIconButton({
  icon,
  label,
  disabled = false,
  tint,
  onPress,
}: {
  icon: IconName;
  label: string;
  disabled?: boolean;
  tint: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, { opacity: disabled ? 0.3 : pressed ? 0.6 : 1 }]}
    >
      <Icon name={icon} size={12} color={tint} />
    </Pressable>
  );
}

/**
 * In-file search in the path row. Open while it holds text or has focus. With
 * text, the leading search icon becomes a clear button that empties the field,
 * closes it, and drops the keyboard. A touch outside the field also drops the
 * keyboard, and the field stays open while it holds text.
 */
export const FileEditorSearch = forwardRef<FileEditorSearchHandle, FileEditorSearchProps>(
  function FileEditorSearch(
    { query, totalMatches, activeMatchIndex, onQueryChange, onNextMatch, onPrevMatch },
    ref,
  ) {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const fieldRef = useRef<View>(null);
    const inputRef = useRef<TextInput>(null);
    const [focused, setFocused] = useState(false);
    const hasQuery = query.trim().length > 0;

    useImperativeHandle(
      ref,
      () => ({
        blurIfOutside: (pageX, pageY) => {
          if (!fieldRef.current || !inputRef.current?.isFocused()) return;
          measurePageRect(fieldRef.current, (rect) => {
            if (!pointInHitRect(pageX, pageY, rect)) inputRef.current?.blur();
          });
        },
      }),
      [],
    );

    if (!hasQuery && !focused) {
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("modal.file_manager.search.open_touch")}
          hitSlop={6}
          onPress={() => {
            setFocused(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          style={({ pressed }) => [styles.openButton, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Icon name="search" size={14} color={colors.onSurfaceVariant} />
        </Pressable>
      );
    }

    const clearAndClose = () => {
      onQueryChange("");
      setFocused(false);
      inputRef.current?.blur();
    };
    const safeActive = totalMatches > 0 ? Math.min(activeMatchIndex, totalMatches - 1) : 0;
    const matchLabel = !hasQuery
      ? ""
      : totalMatches > 0
        ? `${safeActive + 1}/${totalMatches}`
        : "∅";

    return (
      <View
        ref={fieldRef}
        collapsable={false}
        accessibilityRole="search"
        style={[
          styles.field,
          { borderColor: colors.outlineVariant, backgroundColor: colors.surfaceContainerHighest },
        ]}
      >
        {hasQuery ? (
          <SearchIconButton
            icon="close"
            label={t("modal.file_manager.search.clear")}
            tint={colors.onSurfaceVariant}
            onPress={clearAndClose}
          />
        ) : (
          <View style={styles.iconButton}>
            <Icon name="search" size={12} color={colors.onSurfaceVariant} />
          </View>
        )}
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={onQueryChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={onNextMatch}
          submitBehavior="submit"
          returnKeyType="search"
          placeholder={t("modal.file_manager.search.placeholder")}
          placeholderTextColor={colors.onSurfaceVariant}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          accessibilityLabel={t("modal.file_manager.search.placeholder")}
          style={[styles.input, { color: colors.onSurface }]}
        />
        {matchLabel ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.count, { color: colors.onSurfaceVariant }]}
          >
            {matchLabel}
          </Text>
        ) : null}
        <SearchIconButton
          icon="arrow-up"
          label={t("modal.file_manager.search.prev")}
          disabled={totalMatches === 0}
          tint={colors.onSurfaceVariant}
          onPress={onPrevMatch}
        />
        <SearchIconButton
          icon="arrow-down"
          label={t("modal.file_manager.search.next")}
          disabled={totalMatches === 0}
          tint={colors.onSurfaceVariant}
          onPress={onNextMatch}
        />
      </View>
    );
  },
);

const styles = StyleSheet.create({
  openButton: {
    width: 24,
    height: 24,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  field: {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: SEARCH_MAX_WIDTH,
    maxWidth: SEARCH_MAX_WIDTH,
    minWidth: SEARCH_MIN_WIDTH,
    /* The path row's height, so opening the field does not move the row. */
    height: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.full,
  },
  iconButton: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    paddingVertical: 0,
    paddingHorizontal: 2,
  },
  count: { fontSize: 10, fontVariant: ["tabular-nums"], flexShrink: 0 },
});
