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
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme";
import { radii, spacing } from "@/theme/tokens";
import { useTranslation } from "@/i18n";
import { useDropdownOverlay } from "./DropdownOverlayHost";

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

const FALLBACK_TRIGGER_W = 48;
const FALLBACK_TRIGGER_H = 40;

interface MenuSurfaceProps {
  label: string;
  panelTop: number;
  panelLeft: number;
  panelMinW: number;
  maxPanelW: number;
  maxPanelH: number;
  backgroundColor: string;
  close: () => void;
  children: ReactNode;
}

/**
 * Short menus use a plain View (ScrollView + overflow:hidden clipped the last
 * row on Android). Long menus fall back to a capped ScrollView.
 */
function DropdownMenuSurface({
  label,
  panelTop,
  panelLeft,
  panelMinW,
  maxPanelW,
  maxPanelH,
  backgroundColor,
  close,
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
      // Avoid Android expanding an absolute panel to maxHeight (empty gap under EN labels).
      ...(needsScroll || contentH === 0
        ? { maxHeight: maxPanelH }
        : { height: contentH }),
    },
  ];

  const onContentLayout = (event: LayoutChangeEvent) => {
    setContentH(event.nativeEvent.layout.height);
  };

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
          <PanelCloseContext.Provider value={close}>{children}</PanelCloseContext.Provider>
        </ScrollView>
      ) : (
        <View style={styles.scrollContent} onLayout={onContentLayout}>
          <PanelCloseContext.Provider value={close}>{children}</PanelCloseContext.Provider>
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
  const { setOverlay } = useDropdownOverlay();
  const wrapRef = useRef<View>(null);
  const layoutSize = useRef({ width: 0, height: 0 });
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const openRef = useRef(false);
  openRef.current = open;

  const close = useCallback(() => {
    setOpen(false);
    setAnchor(null);
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
      void readAnchor().then((measured) => {
        const w =
          measured?.width ??
          (layoutSize.current.width > 0 ? layoutSize.current.width : FALLBACK_TRIGGER_W);
        const h =
          measured?.height ??
          (layoutSize.current.height > 0 ? layoutSize.current.height : FALLBACK_TRIGGER_H);

        let next = measured;

        if (
          touch &&
          (!next ||
            (next.x < 12 && touch.pageX > next.x + next.width + 24) ||
            (next.y < 12 && touch.pageY > next.y + next.height + 24))
        ) {
          next = {
            x: Math.max(0, touch.pageX - w / 2),
            y: Math.max(0, touch.pageY - h / 2),
            width: w,
            height: h,
          };
        }

        if (!next) return;
        setAnchor(next);
        setOpen(true);
      });
    },
    [readAnchor],
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

    const spaceBelow =
      winH - (anchor.y + anchor.height + gap) - Math.max(insets.bottom, spacing.md);
    const spaceAbove = anchor.y - gap - Math.max(insets.top, spacing.md);

    let panelTop: number;
    let maxPanelH: number;
    if (spaceBelow >= 180 || spaceBelow >= spaceAbove) {
      panelTop = anchor.y + anchor.height + gap;
      maxPanelH = Math.max(120, spaceBelow);
    } else {
      maxPanelH = Math.max(120, spaceAbove);
      panelTop = Math.max(insets.top + spacing.sm, anchor.y - gap - maxPanelH);
    }

    let panelLeft = align === "right" ? anchor.x + anchor.width - panelMinW : anchor.x;
    panelLeft = Math.max(spacing.md, Math.min(panelLeft, winW - panelMinW - spacing.md));

    setOverlay(
      <View key={panelId} style={styles.overlay} pointerEvents="box-none">
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={t("action.dismiss")}
        />
        <DropdownMenuSurface
          label={label}
          panelTop={panelTop}
          panelLeft={panelLeft}
          panelMinW={panelMinW}
          maxPanelW={maxPanelW}
          maxPanelH={maxPanelH}
          backgroundColor={colors.surfaceContainerHigh}
          close={close}
        >
          {children}
        </DropdownMenuSurface>
      </View>,
    );

    return () => {
      setOverlay(null);
    };
  }, [
    align,
    anchor,
    children,
    close,
    colors.surfaceContainerHigh,
    gap,
    insets.bottom,
    insets.top,
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
});
