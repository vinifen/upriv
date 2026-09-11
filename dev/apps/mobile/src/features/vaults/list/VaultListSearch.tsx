import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { normalizeVaultListSearch } from "@upriv/shared";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { CONTROL_HEIGHT_MD, CONTROL_WIDTH_CHROME, radii } from "@/theme/tokens";

const EXPANDED_MAX_WIDTH = 256;
const OPEN_MS = 200;
const CLOSE_MS = 180;

interface VaultListSearchProps {
  value: string;
  onChange: (next: string) => void;
}

export type VaultListSearchHandle = {
  blur: () => void;
  measureShellInWindow: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
};

/**
 * Magnifier that expands into a search field only while focused.
 * Collapse on blur only — Android `keyboardDidHide` also fires when the list
 * refilters, and blurring there stole focus after the first character.
 */
export const VaultListSearch = forwardRef<VaultListSearchHandle, VaultListSearchProps>(
  function VaultListSearch({ value, onChange }, ref) {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const shellRef = useRef<View>(null);
    const inputRef = useRef<TextInput>(null);
    const [focused, setFocused] = useState(false);
    const [slotWidth, setSlotWidth] = useState(CONTROL_WIDTH_CHROME);
    const width = useRef(new Animated.Value(CONTROL_WIDTH_CHROME)).current;
    const hasQuery = value.trim().length > 0;
    const label = t("vault.list.search.label");
    const placeholder = t("vault.list.search.placeholder");
    const showHint = focused && !hasQuery;
    const targetWidth = useMemo(() => {
      if (!focused) return CONTROL_WIDTH_CHROME;
      return Math.min(EXPANDED_MAX_WIDTH, Math.max(CONTROL_WIDTH_CHROME, slotWidth));
    }, [focused, slotWidth]);

    useImperativeHandle(ref, () => ({
      blur: () => {
        inputRef.current?.blur();
      },
      measureShellInWindow: (callback) => {
        shellRef.current?.measureInWindow(callback);
      },
    }));

    useEffect(() => {
      Animated.timing(width, {
        toValue: targetWidth,
        duration: focused ? OPEN_MS : CLOSE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    }, [focused, targetWidth, width]);

    return (
      <View
        collapsable={false}
        style={styles.slot}
        onLayout={(event) => {
          const next = Math.round(event.nativeEvent.layout.width);
          if (next > 0) setSlotWidth(next);
        }}
      >
        <Animated.View
          ref={shellRef}
          collapsable={false}
          style={[styles.shell, { width, borderColor: colors.outlineVariant }]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => inputRef.current?.focus()}
            style={styles.iconCol}
          >
            <Icon
              name="search"
              size={20}
              color={!focused && hasQuery ? colors.accent : colors.onSurfaceVariant}
            />
          </Pressable>
          <View style={styles.field}>
            {showHint ? (
              <View pointerEvents="none" style={styles.hintOverlay}>
                <Text
                  accessible={false}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  style={[styles.hint, { color: colors.onSurfaceVariant }]}
                >
                  {placeholder}
                </Text>
              </View>
            ) : null}
            <TextInput
              ref={inputRef}
              collapsable={false}
              value={value}
              onChangeText={(next) => onChange(normalizeVaultListSearch(next))}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                const trimmed = value.trim();
                if (trimmed !== value) onChange(trimmed);
                setFocused(false);
              }}
              onSubmitEditing={() => inputRef.current?.blur()}
              accessibilityLabel={label}
              accessibilityState={{ selected: hasQuery }}
              autoCorrect={false}
              autoCapitalize="none"
              autoComplete="off"
              importantForAutofill="no"
              spellCheck={false}
              blurOnSubmit={false}
              numberOfLines={1}
              multiline={false}
              returnKeyType="search"
              caretHidden={!focused}
              underlineColorAndroid="transparent"
              style={[
                styles.input,
                {
                  color: focused ? colors.onSurface : "transparent",
                },
              ]}
            />
          </View>
        </Animated.View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  slot: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: CONTROL_WIDTH_CHROME,
    height: CONTROL_HEIGHT_MD,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  shell: {
    height: CONTROL_HEIGHT_MD,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  /** Inner box of the collapsed chrome control (46×40 + 1px border). */
  iconCol: {
    width: CONTROL_WIDTH_CHROME - 2,
    height: CONTROL_HEIGHT_MD - 2,
    alignItems: "center",
    justifyContent: "center",
  },
  field: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    height: CONTROL_HEIGHT_MD - 2,
    justifyContent: "center",
    overflow: "hidden",
  },
  hintOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
  },
  hint: {
    paddingRight: 12,
    fontSize: 15,
    lineHeight: 20,
  },
  input: {
    width: "100%",
    height: CONTROL_HEIGHT_MD - 2,
    paddingRight: 12,
    paddingTop: 0,
    paddingBottom: 0,
    margin: 0,
    fontSize: 15,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
});
