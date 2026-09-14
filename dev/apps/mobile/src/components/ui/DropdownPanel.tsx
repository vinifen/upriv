import {
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  BackHandler,
  InteractionManager,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/icons";
import { useTheme } from "@/theme";
import { radii, spacing } from "@/theme/tokens";
import { useTranslation } from "@/i18n";
import { placeAnchoredMenu } from "@upriv/shared";
import { useDropdownOverlay } from "./DropdownOverlayHost";
import { ScrimDismiss } from "./ScrimDismiss";

type TriggerProps = {
  onPress?: ((event?: GestureResponderEvent) => void) | null;
};

interface AnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DropdownPanelProps {
  /** Accessibility label for the menu (desktop `label`). */
  label: string;
  /**
   * Small uppercase heading inside the panel (desktop `DropdownMenu` / `MenuPanelGroup`).
   * Omit when the children already include group labels (sort / view).
   */
  heading?: string;
  align?: "left" | "right";
  /** Desktop default ~14rem. */
  minWidth?: number;
  /** Pressable / IconButton trigger — opened menu anchors under this control. */
  trigger: ReactElement<TriggerProps>;
  children: ReactNode;
}

const PanelCloseContext = createContext<(() => void) | null>(null);

/** Closes the parent dropdown after selection — desktop `useDropdownPanelClose` parity. */
export function useDropdownPanelClose(): () => void {
  const close = useContext(PanelCloseContext);
  return close ?? (() => undefined);
}

/** Desktop `menuGroupLabelClass` — small uppercase section title inside a menu. */
export function MenuGroupLabel({
  children,
  style,
  withClose = false,
}: {
  children: string;
  style?: StyleProp<TextStyle>;
  /** Put the panel close control on this section title (filter menus). */
  withClose?: boolean;
}) {
  const { colors, typography } = useTheme();
  const close = useDropdownPanelClose();
  if (withClose) {
    return <MenuPanelHeader title={children} onClose={close} />;
  }
  return (
    <Text
      accessibilityRole="text"
      style={[typography.caption, styles.groupLabel, { color: colors.onSurfaceVariant }, style]}
    >
      {children}
    </Text>
  );
}

/** Title + close — sized to the uppercase caption (desktop `MenuPanelHeader`). */
function MenuPanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const { colors, typography } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={styles.headerRow}>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[typography.caption, styles.headerTitle, { color: colors.onSurfaceVariant }]}
        numberOfLines={1}
      >
        {title}
      </Text>
      <Pressable
        onPress={onClose}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t("action.close")}
        style={({ pressed }) => [
          styles.closeBtn,
          pressed ? { backgroundColor: colors.surfaceContainerHighest } : null,
        ]}
      >
        <Icon name="close" size={12} color={colors.onSurfaceVariant} />
      </Pressable>
    </View>
  );
}

const FALLBACK_TRIGGER_W = 48;
const FALLBACK_TRIGGER_H = 40;
/** First paint before `onLayout` — enough for a short ⋮ menu. */
const PANEL_HEIGHT_ESTIMATE = 240;

function triggerSize(
  measured: AnchorRect | null,
  layout: { width: number; height: number },
): { w: number; h: number } {
  return {
    w: measured?.width ?? (layout.width > 0 ? layout.width : FALLBACK_TRIGGER_W),
    h: measured?.height ?? (layout.height > 0 ? layout.height : FALLBACK_TRIGGER_H),
  };
}

function anchorFromTouch(
  touch: { pageX: number; pageY: number },
  w: number,
  h: number,
): AnchorRect {
  return {
    x: Math.max(0, touch.pageX - w / 2),
    y: Math.max(0, touch.pageY - h / 2),
    width: w,
    height: h,
  };
}

function pickAnchor(
  measured: AnchorRect | null,
  touch: { pageX: number; pageY: number } | undefined,
  w: number,
  h: number,
): AnchorRect | null {
  if (!touch) return measured;
  const fromTouch = anchorFromTouch(touch, w, h);
  if (!measured) return fromTouch;

  // FlatList `measure()` y on Android is often the header band / pre-scroll
  // position. Keep measured x/size (those stay correct) and always take
  // the press Y so the menu sits on the row that was tapped.
  return {
    x: measured.x,
    y: fromTouch.y,
    width: measured.width > 0 ? measured.width : w,
    height: measured.height > 0 ? measured.height : h,
  };
}

interface MenuSurfaceProps {
  label: string;
  /** When set (⋮ / settings), show title + close. Filter menus use section `withClose` instead. */
  title: string | null;
  panelTop: number;
  panelLeft: number;
  panelMinW: number;
  maxPanelW: number;
  maxPanelH: number;
  backgroundColor: string;
  close: () => void;
  visible: boolean;
  onHeight: (height: number) => void;
  children: ReactNode;
}

/**
 * Short menus use a plain View (ScrollView + overflow:hidden clipped the last
 * row on Android). Long menus fall back to a capped ScrollView.
 */
function DropdownMenuSurface({
  label,
  title,
  panelTop,
  panelLeft,
  panelMinW,
  maxPanelW,
  maxPanelH,
  backgroundColor,
  close,
  visible,
  onHeight,
  children,
}: MenuSurfaceProps) {
  const [contentH, setContentH] = useState(0);
  const needsScroll = contentH > maxPanelH + 1;

  const panelStyle = [
    styles.panel,
    {
      top: panelTop,
      left: panelLeft,
      minWidth: panelMinW,
      maxWidth: maxPanelW,
      backgroundColor,
      opacity: visible ? 1 : 0,
      // Avoid Android expanding an absolute panel to maxHeight (empty gap under EN labels).
      ...(needsScroll || contentH === 0 ? { maxHeight: maxPanelH } : { height: contentH }),
    },
  ];

  const onContentLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.height);
    if (next <= 0) return;
    setContentH(next);
    onHeight(next);
  };

  const body = (
    <PanelCloseContext.Provider value={close}>
      {title ? <MenuPanelHeader title={title} onClose={close} /> : null}
      {children}
    </PanelCloseContext.Provider>
  );

  return (
    <View accessibilityRole="menu" accessibilityLabel={label} style={panelStyle}>
      {needsScroll ? (
        <ScrollView
          bounces={false}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
        >
          {body}
        </ScrollView>
      ) : (
        <View style={styles.scrollContent} onLayout={onContentLayout}>
          {body}
        </View>
      )}
    </View>
  );
}

/**
 * Anchored menu under the trigger — desktop `DropdownPanel` / `DropdownMenu` parity.
 * Renders through {@link DropdownOverlayProvider} (same window as the trigger).
 */
export function DropdownPanel({
  label,
  heading,
  align = "right",
  minWidth = 224,
  trigger,
  children,
}: DropdownPanelProps) {
  const panelId = useId();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { setOverlay, measureHostOrigin } = useDropdownOverlay();
  const wrapRef = useRef<View>(null);
  const layoutSize = useRef({ width: 0, height: 0 });
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [contentH, setContentH] = useState(0);
  const openRef = useRef(false);
  openRef.current = open;
  const openGen = useRef(0);

  const close = useCallback(() => {
    openGen.current += 1;
    setOpen(false);
    setAnchor(null);
    setContentH(0);
  }, []);

  const readAnchor = useCallback((): Promise<AnchorRect | null> => {
    return new Promise((resolve) => {
      const node = wrapRef.current;
      if (!node) {
        resolve(null);
        return;
      }

      // Prefer measure() pageX/pageY — measureInWindow is unreliable on Android
      // edge-to-edge (SDK 35 / RN 0.76) and was placing menus at the wrong origin.
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

        if (
          !Number.isFinite(pageX) ||
          !Number.isFinite(pageY) ||
          (pageX === 0 && pageY === 0 && w === FALLBACK_TRIGGER_W && layoutSize.current.width === 0)
        ) {
          node.measureInWindow((ix, iy, iw, ih) => {
            const ww = iw > 0 ? iw : w;
            const hh = ih > 0 ? ih : h;
            if (!Number.isFinite(ix) || !Number.isFinite(iy)) {
              resolve(null);
              return;
            }
            resolve({ x: ix, y: iy, width: ww, height: hh });
          });
          return;
        }

        resolve({ x: pageX, y: pageY, width: w, height: h });
      });
    });
  }, []);

  const openMenu = useCallback(
    (touch?: { pageX: number; pageY: number }) => {
      const gen = ++openGen.current;
      const run = () => {
        if (gen !== openGen.current) return;
        void Promise.all([readAnchor(), measureHostOrigin()]).then(([measured, origin]) => {
          if (gen !== openGen.current) return;
          const { w, h } = triggerSize(measured, layoutSize.current);
          const picked = pickAnchor(measured, touch, w, h);
          if (!picked) return;
          setAnchor({
            ...picked,
            x: picked.x - origin.x,
            y: picked.y - origin.y,
          });
          setOpen(true);
        });
      };

      if (touch) {
        run();
        return;
      }

      // No press coordinates (rare) — wait a frame so layout after an RN Modal settles.
      InteractionManager.runAfterInteractions(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(run);
        });
      });
    },
    [measureHostOrigin, readAnchor],
  );

  const onWrapLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    layoutSize.current = { width, height };
  }, []);

  const enhancedTrigger = isValidElement(trigger)
    ? cloneElement(trigger, {
        onPress: (event?: GestureResponderEvent) => {
          trigger.props.onPress?.(event);
          if (openRef.current) {
            close();
            return;
          }
          const pageX = event?.nativeEvent?.pageX;
          const pageY = event?.nativeEvent?.pageY;
          openMenu(
            pageX != null && pageY != null && Number.isFinite(pageX) && Number.isFinite(pageY)
              ? { pageX, pageY }
              : undefined,
          );
        },
      })
    : trigger;

  const gap = spacing.sm;
  const maxPanelW = Math.min(320, winW - spacing.lg * 2);
  const panelMinW = Math.min(minWidth, maxPanelW);

  useLayoutEffect(() => {
    if (!open || !anchor) {
      setOverlay(null);
      return;
    }

    const paddingTop = Math.max(insets.top, spacing.md);
    const paddingBottom = Math.max(insets.bottom, spacing.md);
    const placed = placeAnchoredMenu({
      anchor,
      panelWidth: panelMinW,
      panelHeight: contentH > 0 ? contentH : PANEL_HEIGHT_ESTIMATE,
      viewport: { width: winW, height: winH },
      padding: {
        top: paddingTop,
        right: spacing.md,
        bottom: paddingBottom,
        left: spacing.md,
      },
      gap,
      align,
    });

    setOverlay(
      <View key={panelId} style={styles.overlay}>
        <ScrimDismiss onDismiss={close} accessibilityLabel={t("action.dismiss")} />
        <DropdownMenuSurface
          label={label}
          title={heading ?? null}
          panelTop={placed.top}
          panelLeft={placed.left}
          panelMinW={panelMinW}
          maxPanelW={maxPanelW}
          maxPanelH={placed.maxHeight}
          backgroundColor={colors.surfaceContainerHigh}
          close={close}
          visible={contentH > 0}
          onHeight={setContentH}
        >
          {children}
        </DropdownMenuSurface>
      </View>,
    );
    // Do not `setOverlay(null)` on deps change — that remounts a focused TextInput
    // (search field) on every keystroke. Close / unmount still clear via the
    // `!open` branch above and the unmount effect below.
  }, [
    align,
    anchor,
    children,
    close,
    colors.surfaceContainerHigh,
    contentH,
    gap,
    insets.bottom,
    insets.top,
    heading,
    label,
    maxPanelW,
    open,
    panelId,
    panelMinW,
    setOverlay,
    winH,
    winW,
    t,
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

  return (
    <View ref={wrapRef} collapsable={false} onLayout={onWrapLayout} style={styles.triggerWrap}>
      {enhancedTrigger}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  triggerWrap: {
    alignSelf: "center",
  },
  panel: {
    position: "absolute",
    zIndex: 1,
    flexGrow: 0,
    borderRadius: radii.lg,
    overflow: "hidden",
    elevation: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    flexGrow: 0,
    // Symmetric pad — height hugs items (EN/PT); View path avoids ScrollView clip.
    paddingVertical: spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: 2,
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    textTransform: "uppercase",
    letterSpacing: 1.6,
    fontSize: 10,
    fontWeight: "600",
    opacity: 0.75,
    fontFamily: "monospace",
  },
  closeBtn: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
  },
  groupLabel: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
    textTransform: "uppercase",
    letterSpacing: 1.6,
    fontSize: 10,
    fontWeight: "600",
    opacity: 0.75,
    fontFamily: "monospace",
  },
});
