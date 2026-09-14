import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  InteractionManager,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/icons";
import { useTheme } from "@/theme";
import { controlFocusRing, hexWithAlpha, radii, spacing } from "@/theme/tokens";
import { useTranslation } from "@/i18n";
import { isTriggerOccluded, placeAnchoredMenu } from "@upriv/shared";
import { useDropdownOverlay } from "./DropdownOverlayHost";
import { ScrimDismiss } from "./ScrimDismiss";

export type SelectOptionTone = "default" | "muted" | "danger";

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  tone?: SelectOptionTone;
}

interface SelectProps<T extends string | number> {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Field label above the control. */
  label?: string;
  /** Accessible name when the visible label is elsewhere. */
  title?: string;
  accessibilityLabel?: string;
  /** Visual density — `sm` for compact header locale pickers. */
  size?: "sm" | "md";
}

interface AnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FALLBACK_TRIGGER_W = 160;
const FALLBACK_TRIGGER_H = 48;
const PANEL_HEIGHT_ESTIMATE = 240;
const EDGE = 8;

function optionColor(
  tone: SelectOptionTone | undefined,
  colors: ReturnType<typeof useTheme>["colors"],
): string {
  if (tone === "danger") return colors.onErrorContainer;
  if (tone === "muted") return colors.onSurfaceVariant;
  return colors.onSurface;
}

function optionFill(
  tone: SelectOptionTone | undefined,
  selected: boolean,
  colors: ReturnType<typeof useTheme>["colors"],
): string {
  if (!selected) return "transparent";
  if (tone === "danger") return hexWithAlpha(colors.onErrorContainer, 0.16);
  if (tone === "muted") return "transparent";
  return hexWithAlpha(colors.accent, 0.18);
}

/** Single-value picker — desktop `Select` parity (anchored to the trigger). */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  label,
  title,
  accessibilityLabel,
  size = "md",
}: SelectProps<T>) {
  const { colors, typography } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const { setOverlay, measureHostOrigin } = useDropdownOverlay();
  const wrapRef = useRef<View>(null);
  const layoutSize = useRef({ width: 0, height: 0 });
  const openGen = useRef(0);
  const openRef = useRef(false);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [contentH, setContentH] = useState(0);
  const [menuSide, setMenuSide] = useState<"below" | "above">("below");
  /** Compact trigger min width = widest option (desktop invisible sizers). */
  const [smMinWidth, setSmMinWidth] = useState(0);
  const optionWidths = useRef(new Map<string, number>());
  openRef.current = open;

  const selected = useMemo(
    () => options.find((option) => option.value === value)?.label ?? String(value),
    [options, value],
  );
  const compact = size === "sm";
  const hover = hexWithAlpha(colors.onSurface, 0.08);
  const name = accessibilityLabel ?? title ?? label ?? selected;
  const attachedBelow = open && menuSide === "below";
  const attachedAbove = open && menuSide === "above";
  const fill = colors.surfaceContainerHighest;

  const close = useCallback(() => {
    openGen.current += 1;
    setOpen(false);
    setAnchor(null);
    setContentH(0);
    setMenuSide("below");
  }, []);

  const readAnchor = useCallback((): Promise<AnchorRect | null> => {
    return new Promise((resolve) => {
      const node = wrapRef.current;
      if (!node) {
        resolve(null);
        return;
      }
      node.measure((_x, _y, width, height, pageX, pageY) => {
        const w =
          width > 0
            ? width
            : layoutSize.current.width > 0
              ? layoutSize.current.width
              : FALLBACK_TRIGGER_W;
        const h =
          height > 0
            ? height
            : layoutSize.current.height > 0
              ? layoutSize.current.height
              : FALLBACK_TRIGGER_H;
        if (!Number.isFinite(pageX) || !Number.isFinite(pageY)) {
          resolve(null);
          return;
        }
        resolve({ x: pageX, y: pageY, width: w, height: h });
      });
    });
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    if (openRef.current) {
      close();
      return;
    }
    const gen = ++openGen.current;
    const run = () => {
      if (gen !== openGen.current) return;
      void Promise.all([readAnchor(), measureHostOrigin()]).then(([measured, origin]) => {
        if (gen !== openGen.current || !measured) return;
        setAnchor({
          x: measured.x - origin.x,
          y: measured.y - origin.y,
          width: measured.width,
          height: measured.height,
        });
        setOpen(true);
      });
    };
    InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(run);
    });
  }, [close, disabled, measureHostOrigin, readAnchor]);

  const pick = useCallback(
    (next: T) => {
      onChange(next);
      close();
    },
    [close, onChange],
  );

  const syncAnchor = useCallback(() => {
    if (!openRef.current) return;
    const gen = openGen.current;
    void Promise.all([readAnchor(), measureHostOrigin()]).then(([measured, origin]) => {
      if (gen !== openGen.current || !measured) return;
      const x = measured.x - origin.x;
      const y = measured.y - origin.y;
      if (
        isTriggerOccluded(
          { top: y, left: x, right: x + measured.width, bottom: y + measured.height },
          [],
          { width: winW, height: winH },
          EDGE,
        )
      ) {
        close();
        return;
      }
      const next = { x, y, width: measured.width, height: measured.height };
      setAnchor((current) =>
        current &&
        current.x === next.x &&
        current.y === next.y &&
        current.width === next.width &&
        current.height === next.height
          ? current
          : next,
      );
    });
  }, [close, measureHostOrigin, readAnchor, winH, winW]);

  const onWrapLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      layoutSize.current = { width, height };
      if (openRef.current) syncAnchor();
    },
    [syncAnchor],
  );

  useEffect(() => {
    if (!open) return;
    syncAnchor();
  }, [open, syncAnchor, insets.bottom, insets.left, insets.right, insets.top, winH, winW]);

  useLayoutEffect(() => {
    if (!open || !anchor) {
      setOverlay(null);
      return;
    }

    const paddingTop = Math.max(insets.top, EDGE);
    const paddingBottom = Math.max(insets.bottom, EDGE);
    const maxPanelW = Math.max(1, winW - EDGE * 2);
    // Match trigger width (desktop `matchTriggerWidth`) so CTA + menu read as one control.
    const panelWidth = Math.min(maxPanelW, Math.max(1, anchor.width));
    const placed = placeAnchoredMenu({
      anchor,
      panelWidth,
      panelHeight: contentH > 0 ? contentH : PANEL_HEIGHT_ESTIMATE,
      viewport: { width: winW, height: winH },
      padding: {
        top: paddingTop,
        right: EDGE,
        bottom: paddingBottom,
        left: EDGE,
      },
      gap: -1,
      align: compact ? "right" : "left",
    });
    setMenuSide(placed.side);

    const below = placed.side === "below";
    const needsScroll = contentH > placed.maxHeight + 1;
    const radius = radii.md;
    const shadowPad = 22;

    setOverlay(
      <View key={listId} style={styles.overlay}>
        <ScrimDismiss onDismiss={close} accessibilityLabel={t("action.dismiss")} />
        <View
          pointerEvents="box-none"
          collapsable={false}
          style={{
            position: "absolute",
            zIndex: 1,
            top: below ? placed.top : placed.top - shadowPad,
            left: placed.left - shadowPad,
            width: panelWidth + shadowPad * 2,
            overflow: contentH > 0 ? "hidden" : "visible",
            paddingTop: below ? 0 : shadowPad,
            paddingBottom: below ? shadowPad : 0,
            paddingHorizontal: shadowPad,
          }}
        >
          <View
            accessibilityRole="list"
            accessibilityLabel={name}
            style={[
              styles.panel,
              {
                width: panelWidth,
                backgroundColor: fill,
                opacity: contentH > 0 ? 1 : 0,
                borderTopLeftRadius: below ? 0 : radius,
                borderTopRightRadius: below ? 0 : radius,
                borderBottomLeftRadius: below ? radius : 0,
                borderBottomRightRadius: below ? radius : 0,
                boxShadow: below
                  ? "0 12px 24px -4px rgba(0,0,0,0.40)"
                  : "0 -12px 24px -4px rgba(0,0,0,0.40)",
                ...(contentH === 0
                  ? null
                  : needsScroll
                    ? { height: placed.maxHeight }
                    : { height: contentH }),
              },
            ]}
          >
            <View
              style={{
                overflow: "hidden",
                borderTopLeftRadius: below ? 0 : radius,
                borderTopRightRadius: below ? 0 : radius,
                borderBottomLeftRadius: below ? radius : 0,
                borderBottomRightRadius: below ? radius : 0,
                ...(needsScroll ? { flex: 1 } : null),
              }}
            >
              {needsScroll ? (
                <ScrollView
                  bounces={false}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator
                  persistentScrollbar
                  style={styles.scroll}
                  contentContainerStyle={styles.menu}
                >
                  {options.map((opt) => (
                    <SelectOptionRow
                      key={String(opt.value)}
                      option={opt}
                      selected={opt.value === value}
                      hover={hover}
                      colors={colors}
                      typography={typography}
                      onPress={() => pick(opt.value)}
                    />
                  ))}
                </ScrollView>
              ) : (
                <View
                  style={styles.menu}
                  onLayout={(event) => {
                    const next = Math.round(event.nativeEvent.layout.height);
                    if (next > 0) setContentH((current) => (current === next ? current : next));
                  }}
                >
                  {options.map((opt) => (
                    <SelectOptionRow
                      key={String(opt.value)}
                      option={opt}
                      selected={opt.value === value}
                      hover={hover}
                      colors={colors}
                      typography={typography}
                      onPress={() => pick(opt.value)}
                    />
                  ))}
                </View>
              )}
            </View>
          </View>
        </View>
      </View>,
    );
  }, [
    anchor,
    close,
    colors,
    compact,
    contentH,
    fill,
    hover,
    insets.bottom,
    insets.top,
    listId,
    name,
    open,
    options,
    pick,
    setOverlay,
    t,
    typography,
    value,
    winH,
    winW,
  ]);

  useEffect(() => () => setOverlay(null), [setOverlay]);

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [close, open]);

  const onOptionSizerLayout = useCallback((key: string, labelWidth: number) => {
    optionWidths.current.set(key, labelWidth);
    let widest = 0;
    for (const w of optionWidths.current.values()) {
      if (w > widest) widest = w;
    }
    // padding + gap + chevron — keep CTA and menu the same width.
    const next = Math.ceil(widest + spacing.md * 2 + spacing.sm + 14);
    setSmMinWidth((current) => (current === next ? current : next));
  }, []);

  useEffect(() => {
    optionWidths.current.clear();
    setSmMinWidth(0);
  }, [options]);

  return (
    <View style={compact ? styles.wrapSm : styles.wrap}>
      {label && !compact ? (
        <Text
          style={[
            typography.body,
            { color: colors.onSurface, fontWeight: "500" },
            disabled ? { opacity: 0.6 } : null,
          ]}
        >
          {label}
        </Text>
      ) : null}
      {compact ? (
        <View
          style={styles.sizerHost}
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
        >
          {options.map((option) => (
            <Text
              key={`sizer-${String(option.value)}`}
              style={[typography.caption, styles.sizerText]}
              onLayout={(event) => {
                onOptionSizerLayout(String(option.value), event.nativeEvent.layout.width);
              }}
            >
              {option.label}
            </Text>
          ))}
        </View>
      ) : null}
      <View style={compact ? styles.triggerWrapSm : styles.triggerWrap}>
        <Pressable
          ref={wrapRef}
          collapsable={false}
          onLayout={onWrapLayout}
          disabled={disabled}
          accessibilityRole="combobox"
          accessibilityState={{ expanded: open, disabled: Boolean(disabled) }}
          accessibilityLabel={name}
          onPress={openMenu}
          style={({ pressed }) => [
            styles.control,
            compact ? styles.controlSm : styles.controlMd,
            compact && smMinWidth > 0 ? { minWidth: smMinWidth } : null,
            {
              backgroundColor: fill,
              opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
              borderTopLeftRadius: attachedAbove ? 0 : radii.md,
              borderTopRightRadius: attachedAbove ? 0 : radii.md,
              borderBottomLeftRadius: attachedBelow ? 0 : radii.md,
              borderBottomRightRadius: attachedBelow ? 0 : radii.md,
              ...controlFocusRing(colors.accent, fill, false),
            },
          ]}
        >
          <Text
            style={[
              compact ? typography.caption : typography.body,
              compact ? styles.valueSm : styles.valueMd,
              { color: colors.onSurface },
            ]}
            numberOfLines={1}
          >
            {selected}
          </Text>
          <Icon name="chevron-down" size={compact ? 14 : 18} color={colors.onSurfaceVariant} />
        </Pressable>
      </View>
    </View>
  );
}

function SelectOptionRow<T extends string | number>({
  option,
  selected,
  hover,
  colors,
  typography,
  onPress,
}: {
  option: SelectOption<T>;
  selected: boolean;
  hover: string;
  colors: ReturnType<typeof useTheme>["colors"];
  typography: ReturnType<typeof useTheme>["typography"];
  onPress: () => void;
}) {
  const fill = optionFill(option.tone, selected, colors);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.option, { backgroundColor: pressed ? hover : fill }]}
    >
      <Text
        style={[
          typography.body,
          {
            color: optionColor(option.tone, colors),
            fontWeight: selected ? "600" : "400",
            includeFontPadding: false,
            flex: 1,
          },
        ]}
        numberOfLines={1}
      >
        {option.label}
      </Text>
      <Text
        style={[styles.check, { color: selected ? colors.vaultStatusOpen : "transparent" }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        ✓
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, alignSelf: "stretch" },
  /** Header locale pickers — hug widest option; menu matches trigger. */
  wrapSm: { alignSelf: "flex-start", maxWidth: 256, flexShrink: 0 },
  triggerWrap: { alignSelf: "stretch" },
  triggerWrapSm: { alignSelf: "flex-start" },
  sizerHost: {
    position: "absolute",
    opacity: 0,
    left: 0,
    top: 0,
    zIndex: -1,
  },
  sizerText: {
    position: "absolute",
    left: 0,
    top: 0,
  },
  control: {
    minHeight: 48,
    borderRadius: radii.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  controlMd: {
    width: "100%",
    alignSelf: "stretch",
  },
  controlSm: {
    minHeight: 40,
    maxWidth: 256,
    alignSelf: "flex-start",
    borderRadius: radii.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.md,
  },
  valueMd: { flex: 1, minWidth: 0 },
  valueSm: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  overlay: { flex: 1 },
  panel: {
    overflow: "visible",
  },
  scroll: { flexGrow: 0 },
  menu: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  option: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
  },
  check: {
    width: 16,
    textAlign: "center",
    fontSize: 12,
    fontFamily: "monospace",
  },
});
