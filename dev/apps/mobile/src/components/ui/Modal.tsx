import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
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
import { Icon, type IconName } from "@/components/icons";
import {
  MODAL_CLOSE_MS,
  MODAL_OPEN_MS,
  MODAL_SCALE_FROM,
  acquireOpenModal,
  releaseOpenModal,
} from "@upriv/shared";
import { useTheme } from "@/theme";
import { MODAL_MAX_HEIGHT_RATIO, modalShadow, radii, spacing } from "@/theme/tokens";
import { useTranslation } from "@/i18n";
import { DropdownOverlayProvider } from "./DropdownOverlayHost";
import { ScrimDismiss } from "./ScrimDismiss";

/** Tailwind-equivalent widths used by desktop `panelClassName`. */
export type ModalPanelClassName = "max-w-md" | "max-w-lg" | "max-w-2xl" | "max-w-3xl" | "max-w-5xl";

const PANEL_MAX_WIDTH: Record<ModalPanelClassName, number> = {
  "max-w-md": 448,
  "max-w-lg": 512,
  "max-w-2xl": 672,
  "max-w-3xl": 768,
  "max-w-5xl": 1024,
};

/** Desktop Modal CSS `cubic-bezier(0.22, 1, 0.36, 1)`. */
const enterEase = Easing.bezier(0.22, 1, 0.36, 1);

export interface ModalProps {
  open: boolean;
  title: string;
  /** Shown to the right of `title` (vault or group display name). */
  contextTitle?: string;
  titleIcon?: IconName;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Extra controls beside the close button (e.g. options menu). */
  headerActions?: ReactNode;
  /** Panel width utility — same tokens as desktop (`max-w-lg` default). */
  panelClassName?: ModalPanelClassName;
  /** When false, hide close control and ignore back / backdrop (blocking flows). */
  dismissible?: boolean;
  /**
   * When false, children are not wrapped in ScrollView — use for FlatList
   * or a caller-owned scroll pane (avoids VirtualizedList-in-ScrollView).
   */
  bodyScroll?: boolean;
  /** Extra panel styles (escape hatch; prefer `panelClassName`). */
  panelStyle?: StyleProp<ViewStyle>;
  /** Smaller title cluster — File Manager / short dialogs. */
  compact?: boolean;
  /** Drawn over the dialog (toasts) — same window as `RnModal`. */
  overlay?: ReactNode;
}

/** Centered dialog — desktop Modal parity. */
export function Modal({
  open,
  title,
  contextTitle,
  titleIcon,
  onClose,
  children,
  footer,
  headerActions,
  panelClassName = "max-w-lg",
  dismissible = true,
  bodyScroll = true,
  panelStyle,
  compact = false,
  overlay,
}: ModalProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { colors, typography } = useTheme();
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(open);
  const [dialogBodyHeight, setDialogBodyHeight] = useState(0);
  const [dialogHeaderHeight, setDialogHeaderHeight] = useState(0);
  const [dialogFooterHeight, setDialogFooterHeight] = useState(0);
  const opacity = useRef(new Animated.Value(open ? 1 : 0)).current;
  const scale = useRef(new Animated.Value(open ? 1 : MODAL_SCALE_FROM)).current;
  const hasFooter = Boolean(footer);
  const enterStarted = useRef(false);
  const enterGen = useRef(0);

  useEffect(() => {
    if (!hasFooter) setDialogFooterHeight(0);
  }, [hasFooter]);

  useEffect(() => {
    if (!mounted) return;
    acquireOpenModal();
    return () => releaseOpenModal();
  }, [mounted]);

  const startEnter = () => {
    if (enterStarted.current) return;
    enterStarted.current = true;
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: MODAL_OPEN_MS,
        easing: enterEase,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: MODAL_OPEN_MS,
        easing: enterEase,
        useNativeDriver: true,
      }),
    ]).start();
  };

  useEffect(() => {
    if (open) {
      const gen = ++enterGen.current;
      enterStarted.current = false;
      setMounted(true);
      setDialogBodyHeight(0);
      setDialogHeaderHeight(0);
      setDialogFooterHeight(0);
      opacity.setValue(0);
      scale.setValue(MODAL_SCALE_FROM);
      // Fallback when `onShow` is late/missing (some Android builds).
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => {
          if (gen === enterGen.current) startEnter();
        });
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }

    if (!mounted) return;

    const gen = ++enterGen.current;
    enterStarted.current = false;
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: MODAL_CLOSE_MS,
        easing: enterEase,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: MODAL_SCALE_FROM,
        duration: MODAL_CLOSE_MS,
        easing: enterEase,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished && gen === enterGen.current) setMounted(false);
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- animate on open edge only

  const framePadTop = Math.max(insets.top, spacing.md);
  const framePadBottom = Math.max(insets.bottom, spacing.md);
  const framePadH = spacing.md;
  const panelMaxH = useMemo(
    () =>
      Math.max(
        240,
        Math.round(windowHeight * MODAL_MAX_HEIGHT_RATIO) - framePadTop - framePadBottom,
      ),
    [windowHeight, framePadTop, framePadBottom],
  );

  if (!mounted) return null;

  const maxWidth = PANEL_MAX_WIDTH[panelClassName];
  const dialogChrome =
    spacing.lg +
    (dialogHeaderHeight > 0 ? dialogHeaderHeight : 56) +
    (hasFooter ? (dialogFooterHeight > 0 ? dialogFooterHeight : 72) : 0);
  const dialogBodyMax = Math.max(80, panelMaxH - dialogChrome);
  const dialogNeedsScroll = dialogBodyHeight > dialogBodyMax + 1;
  const dialogScrollStyle = {
    maxHeight: dialogBodyMax,
    flexGrow: 0 as const,
    flexShrink: 1 as const,
    ...(dialogBodyHeight > 0
      ? { height: Math.min(dialogBodyHeight, dialogBodyMax) }
      : { minHeight: 48 }),
  };

  const body = bodyScroll ? (
    <ScrollView
      style={[styles.bodyScroll, hasFooter ? dialogScrollStyle : styles.bodyScrollShrink]}
      contentContainerStyle={styles.body}
      onContentSizeChange={(_w, h) => {
        if (hasFooter) setDialogBodyHeight(h);
      }}
      scrollEnabled={!hasFooter || dialogNeedsScroll}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="none"
      showsVerticalScrollIndicator={!hasFooter || dialogNeedsScroll}
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
      onShow={startEnter}
      onRequestClose={dismissible ? onClose : undefined}
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <DropdownOverlayProvider>
          <View style={styles.root}>
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { backgroundColor: colors.modalScrim, opacity }]}
            />
            <ScrimDismiss
              enabled={dismissible}
              onDismiss={onClose}
              accessibilityLabel={t("action.dismiss")}
            />
            <View
              style={[
                styles.frame,
                {
                  paddingTop: framePadTop,
                  paddingBottom: framePadBottom,
                  paddingHorizontal: framePadH,
                  zIndex: 1,
                },
              ]}
              pointerEvents="box-none"
            >
              <Animated.View
                accessibilityLabel={contextTitle ? `${title}. ${contextTitle}` : title}
                pointerEvents="auto"
                style={[
                  styles.panel,
                  {
                    backgroundColor: colors.surfaceContainerHigh,
                    maxWidth,
                    width: "100%",
                    maxHeight: panelMaxH,
                    opacity,
                    transform: [{ scale }],
                    paddingBottom: footer ? 0 : spacing.lg,
                  },
                  panelStyle,
                ]}
              >
                <View
                  style={[styles.header, compact ? styles.headerCompact : null]}
                  onLayout={(event) => setDialogHeaderHeight(event.nativeEvent.layout.height)}
                >
                  <View style={styles.headerLeading}>
                    {titleIcon ? (
                      <Icon
                        name={titleIcon}
                        size={compact ? 15 : 16}
                        color={colors.onSurfaceVariant}
                      />
                    ) : null}
                    <Text
                      style={[
                        compact
                          ? [styles.titleCompact, { color: colors.onSurface }]
                          : typography.headline,
                        contextTitle ? styles.titleWithContext : styles.title,
                        styles.headerType,
                      ]}
                      numberOfLines={1}
                    >
                      {title}
                    </Text>
                    {contextTitle ? (
                      <>
                        <Text
                          style={[styles.separator, { color: colors.onSurfaceVariant }]}
                          accessible={false}
                        >
                          —
                        </Text>
                        <Text
                          style={[styles.contextTitle, { color: colors.onSurfaceVariant }]}
                          numberOfLines={1}
                        >
                          {contextTitle}
                        </Text>
                      </>
                    ) : null}
                  </View>
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
                        <Icon name="close" size={16} color={colors.onSurface} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>

                {body}

                {footer ? (
                  <View
                    style={styles.footer}
                    onLayout={(event) => setDialogFooterHeight(event.nativeEvent.layout.height)}
                  >
                    {footer}
                  </View>
                ) : null}
              </Animated.View>
            </View>
            {overlay ? (
              <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
                {overlay}
              </View>
            ) : null}
          </View>
        </DropdownOverlayProvider>
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
  panel: {
    flexDirection: "column",
    borderRadius: radii.lg,
    overflow: "visible",
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    ...modalShadow,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 14,
    paddingBottom: 22,
    gap: spacing.sm,
    flexShrink: 0,
  },
  headerCompact: {
    paddingTop: 4,
    paddingBottom: 14,
  },
  headerLeading: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  headerType: {
    includeFontPadding: false,
    textAlignVertical: "center",
    lineHeight: 18,
  },
  title: { flex: 1, minWidth: 0 },
  titleCompact: { fontSize: 16, fontWeight: "600" },
  titleWithContext: { flexShrink: 0 },
  separator: {
    flexShrink: 0,
    fontSize: 14,
    lineHeight: 18,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  contextTitle: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "400",
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  headerTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexShrink: 0,
  },
  closeBtn: {
    alignItems: "center",
    justifyContent: "center",
  },
  bodyScroll: {
    flexGrow: 0,
    flexShrink: 1,
    minHeight: 0,
  },
  bodyScrollShrink: {
    flexShrink: 1,
    minHeight: 0,
  },
  body: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
    flexGrow: 0,
  },
  bodyOwned: {
    overflow: "hidden",
  },
  footer: {
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
    flexShrink: 0,
  },
});
