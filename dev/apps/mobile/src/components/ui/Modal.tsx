import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Modal as RnModal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/icons";
import { useTheme } from "@/theme";
import { MODAL_MAX_HEIGHT_RATIO, radii, spacing } from "@/theme/tokens";
import { useTranslation } from "@/i18n";

export type ModalVariant = "dialog" | "menu";

/** Desktop DropdownMenu / DropdownPanel placement for `variant="menu"`. */
export type ModalMenuPlacement = "popover" | "center";

/** Tailwind-equivalent widths used by desktop `panelClassName`. */
export type ModalPanelClassName = "max-w-md" | "max-w-lg" | "max-w-2xl" | "max-w-3xl" | "max-w-5xl";

const PANEL_MAX_WIDTH: Record<ModalPanelClassName, number> = {
  "max-w-md": 448,
  "max-w-lg": 512,
  "max-w-2xl": 672,
  "max-w-3xl": 768,
  "max-w-5xl": 1024,
};

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Extra controls beside the close button (e.g. options menu). */
  headerActions?: ReactNode;
  /**
   * Panel width utility — same tokens as desktop (`max-w-lg` default).
   * Ignored when `variant="menu"`.
   */
  panelClassName?: ModalPanelClassName;
  /** When false, hide close control and ignore back / backdrop (blocking flows). */
  dismissible?: boolean;
  /**
   * Mobile-only: `menu` = desktop DropdownMenu / DropdownPanel chrome
   * (no title bar / X; compact popover).
   */
  variant?: ModalVariant;
  /**
   * `popover` — top-right under app chrome (⋮ / sort / view). Default for menus.
   * `center` — compact centered panel (Select inside dialogs).
   */
  menuPlacement?: ModalMenuPlacement;
  /**
   * When false, children are not wrapped in ScrollView — use for FlatList
   * or a caller-owned scroll pane (avoids VirtualizedList-in-ScrollView).
   */
  bodyScroll?: boolean;
  /** Extra panel styles (escape hatch; prefer `panelClassName`). */
  panelStyle?: StyleProp<ViewStyle>;
}

const OPEN_MS = 180;
const CLOSE_MS = 140;

/**
 * Centered dialog (`variant="dialog"`) mirrors desktop Modal.
 * `variant="menu"` mirrors desktop DropdownMenu / DropdownPanel (no chrome).
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  headerActions,
  panelClassName = "max-w-lg",
  dismissible = true,
  variant = "dialog",
  menuPlacement = "popover",
  bodyScroll = true,
  panelStyle,
}: ModalProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { colors, typography } = useTheme();
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(open);
  const [menuContentHeight, setMenuContentHeight] = useState(0);
  const [dialogBodyHeight, setDialogBodyHeight] = useState(0);
  const opacity = useRef(new Animated.Value(open ? 1 : 0)).current;
  const scale = useRef(new Animated.Value(open ? 1 : 0.96)).current;
  const isMenu = variant === "menu";
  const menuPopover = isMenu && menuPlacement === "popover";
  const scrollFooterLayout = Boolean(footer) && !isMenu;

  useEffect(() => {
    if (open) {
      setMounted(true);
      setMenuContentHeight(0);
      setDialogBodyHeight(0);
      opacity.setValue(0);
      scale.setValue(menuPopover ? 0.98 : 0.96);
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: OPEN_MS,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: OPEN_MS,
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    if (!mounted) return;

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: CLOSE_MS,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: menuPopover ? 0.98 : 0.96,
        duration: CLOSE_MS,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- animate on open edge only

  const framePadTop = menuPopover
    ? Math.max(insets.top, spacing.sm) + 52
    : Math.max(insets.top, spacing.md);
  const framePadBottom = Math.max(insets.bottom, spacing.md);
  const framePadH = spacing.md;
  /**
   * Space left under the popover origin. Bound the *ScrollView* (not only the panel):
   * otherwise RN sizes the ScrollView to full content, parent `overflow:hidden` clips
   * it, and long filter lists lose the last rows with no scroll.
   */
  const maxPanelHeight = useMemo(
    () => Math.max(280, windowHeight - framePadTop - framePadBottom),
    [windowHeight, framePadTop, framePadBottom],
  );
  const dialogMaxHeight = useMemo(
    () =>
      Math.max(
        240,
        Math.round(windowHeight * MODAL_MAX_HEIGHT_RATIO) - framePadTop - framePadBottom,
      ),
    [windowHeight, framePadTop, framePadBottom],
  );

  if (!mounted) return null;

  const maxWidth = isMenu ? 280 : PANEL_MAX_WIDTH[panelClassName];
  const scrimColor = isMenu ? "rgba(0,0,0,0.35)" : colors.modalScrim;
  const panelMaxH = isMenu ? maxPanelHeight : dialogMaxHeight;
  // Android ScrollView often expands to maxHeight; pin height to content when short
  // so locale/theme menus (~3 rows) hug content and do not scroll empty space.
  const menuNeedsScroll = menuContentHeight > maxPanelHeight + 1;
  const menuScrollStyle = {
    maxHeight: maxPanelHeight,
    flexGrow: 0 as const,
    ...(menuContentHeight > 0 ? { height: Math.min(menuContentHeight, maxPanelHeight) } : null),
  };

  // Menus: scroll only when content exceeds the cap. Dialogs: hug content up to
  // panelMaxH. Measure body height so late-arriving children (e.g. settings
  // loaded after open) expand the panel instead of staying at height 0 on Android.
  const dialogBodyMax = Math.max(120, panelMaxH - 160);
  const dialogNeedsScroll = dialogBodyHeight > dialogBodyMax + 1;
  const dialogScrollStyle = {
    maxHeight: dialogBodyMax,
    flexGrow: 0 as const,
    flexShrink: 1 as const,
    ...(dialogBodyHeight > 0
      ? { height: Math.min(dialogBodyHeight, dialogBodyMax) }
      : { minHeight: 48 }),
  };

  const body = isMenu ? (
    <ScrollView
      style={menuScrollStyle}
      contentContainerStyle={styles.bodyMenu}
      onContentSizeChange={(_w, h) => setMenuContentHeight(h)}
      scrollEnabled={menuNeedsScroll}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={menuNeedsScroll}
      bounces={false}
      nestedScrollEnabled
    >
      {children}
    </ScrollView>
  ) : bodyScroll ? (
    <ScrollView
      style={[
        styles.bodyScroll,
        scrollFooterLayout ? dialogScrollStyle : styles.bodyScrollShrink,
      ]}
      contentContainerStyle={styles.body}
      onContentSizeChange={(_w, h) => {
        if (scrollFooterLayout) setDialogBodyHeight(h);
      }}
      scrollEnabled={!scrollFooterLayout || dialogNeedsScroll}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={!scrollFooterLayout || dialogNeedsScroll}
      bounces={false}
      nestedScrollEnabled
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.bodyScroll, styles.body, styles.bodyOwned]}>{children}</View>
  );

  return (
    <RnModal
      visible={mounted}
      animationType="none"
      transparent
      statusBarTranslucent
      onRequestClose={dismissible ? onClose : undefined}
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View
          style={[
            styles.frame,
            menuPopover ? styles.framePopover : null,
            {
              paddingTop: framePadTop,
              paddingBottom: framePadBottom,
              paddingHorizontal: framePadH,
            },
          ]}
          pointerEvents="box-none"
        >
          <Animated.View
            pointerEvents="box-none"
            style={[StyleSheet.absoluteFill, { backgroundColor: scrimColor, opacity }]}
          >
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={dismissible ? onClose : undefined}
              accessibilityRole="button"
              accessibilityLabel={t("action.dismiss")}
            />
          </Animated.View>

          <Animated.View
            accessibilityRole="menu"
            accessibilityLabel={title}
            style={[
              styles.panel,
              isMenu ? styles.menuPanel : styles.dialogPanel,
              {
                backgroundColor: colors.surfaceContainerHigh,
                borderColor: colors.outlineVariant,
                maxWidth,
                width: isMenu ? undefined : "100%",
                minWidth: isMenu ? 192 : undefined,
                maxHeight: panelMaxH,
                opacity,
                transform: [{ scale }],
                paddingBottom: footer ? 0 : isMenu ? 0 : spacing.lg,
                alignSelf: menuPopover ? "flex-end" : "center",
              },
              panelStyle,
            ]}
          >
            {!isMenu ? (
              <View style={styles.header}>
                <Text style={[typography.headline, styles.title]} numberOfLines={2}>
                  {title}
                </Text>
                <View style={styles.headerTrailing}>
                  {headerActions}
                  {dismissible ? (
                    <Pressable
                      onPress={onClose}
                      hitSlop={12}
                      accessibilityRole="button"
                      accessibilityLabel={t("action.close")}
                      style={styles.closeBtn}
                    >
                      <Icon name="close" size={20} color={colors.onSurfaceVariant} />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}

            {body}

            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </RnModal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  frame: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  /** Desktop dropdown: hang under header, flush end. */
  framePopover: {
    justifyContent: "flex-start",
    alignItems: "flex-end",
  },
  panel: {
    flexDirection: "column",
    borderRadius: radii.lg,
  },
  dialogPanel: {
    overflow: "hidden",
    borderWidth: 1,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  /** Desktop `menuPanelClass`: no border, shadow, tight padding. */
  menuPanel: {
    overflow: "hidden",
    borderWidth: 0,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
    paddingHorizontal: 0,
    elevation: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
    gap: spacing.md,
    flexShrink: 0,
    minHeight: 40,
  },
  title: { flex: 1, minWidth: 0 },
  headerTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexShrink: 0,
  },
  closeBtn: {
    minWidth: 36,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  bodyScroll: {
    flexGrow: 0,
    flexShrink: 1,
    minHeight: 0,
  },
  /** With footer: allow body to shrink under panel maxHeight so only one scroll. */
  bodyScrollShrink: {
    flexShrink: 1,
    minHeight: 0,
  },
  body: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
    flexGrow: 0,
  },
  /** Caller-owned scroll (`bodyScroll={false}`) — clip so nested lists own the scrollbar. */
  bodyOwned: {
    overflow: "hidden",
  },
  bodyMenu: {
    gap: 0,
    flexGrow: 0,
    paddingVertical: spacing.sm,
  },
  footer: {
    marginTop: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
    flexShrink: 0,
  },
});
