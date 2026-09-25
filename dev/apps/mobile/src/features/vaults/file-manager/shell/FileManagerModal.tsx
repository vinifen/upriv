import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Easing,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  MODAL_CLOSE_MS,
  MODAL_OPEN_MS,
  MODAL_SCALE_FROM,
  acquireOpenModal,
  releaseOpenModal,
} from "@upriv/shared";
import { Icon } from "@/components/icons";
import { IconButton } from "@/components/ui";
import { ScrimDismiss } from "@/components/ui/ScrimDismiss";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { modalShadow, radii, spacing } from "@/theme/tokens";

interface FileManagerModalProps {
  open: boolean;
  title: string;
  contextTitle?: string;
  onMinimize: () => void;
  onDismiss: () => void;
  /** When true, back / backdrop must not minimize (unsaved dialog active). */
  suspendMinimize?: boolean;
  /**
   * Keep children mounted after the overlay hides so minimized vaults can keep
   * in-flight import skeletons and session state.
   */
  keepMounted?: boolean;
  children: ReactNode;
}

const enterEase = Easing.bezier(0.22, 1, 0.36, 1);

/**
 * Desktop `FileManagerModal` parity: centered panel over scrim (not fullscreen).
 * Absolute overlay (not RnModal) so the floating dock can sit above — same as desktop z-index.
 */
export function FileManagerModal({
  open,
  title,
  contextTitle,
  onMinimize,
  onDismiss,
  suspendMinimize = false,
  keepMounted = false,
  children,
}: FileManagerModalProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const [mounted, setMounted] = useState(open);
  const [collapsed, setCollapsed] = useState(!open);
  const opacity = useRef(new Animated.Value(open ? 1 : 0)).current;
  const scale = useRef(new Animated.Value(open ? 1 : MODAL_SCALE_FROM)).current;
  const enterStarted = useRef(false);
  const enterGen = useRef(0);

  // Desktop FM: `h-[calc(100vh-48px)]` with ~24px margins; keep safe-area, stay taller than generic modals.
  const framePadTop = Math.max(insets.top, 12);
  const framePadBottom = Math.max(insets.bottom, 12);
  const framePadH = spacing.sm;
  const panelMaxH = useMemo(
    () => Math.max(280, windowHeight - framePadTop - framePadBottom),
    [windowHeight, framePadTop, framePadBottom],
  );
  // Near-full width like desktop `sm:w-[calc(100vw-72px)]`.
  const panelWidth = Math.min(windowWidth - framePadH * 2, windowWidth - 16);

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
      setCollapsed(false);
      opacity.setValue(0);
      scale.setValue(MODAL_SCALE_FROM);
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
      if (!finished || gen !== enterGen.current) return;
      if (!keepMounted) setMounted(false);
      setCollapsed(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animate on open edge only
  }, [open, keepMounted]);

  useEffect(() => {
    if (!open) return;
    acquireOpenModal();
    return () => releaseOpenModal();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (suspendMinimize) return true;
      onMinimize();
      return true;
    });
    return () => sub.remove();
  }, [open, onMinimize, suspendMinimize]);

  if (!mounted) return null;

  const showChrome = !collapsed;

  return (
    <View
      pointerEvents={showChrome ? "box-none" : "none"}
      style={showChrome ? styles.root : styles.collapsedHost}
      accessibilityViewIsModal={showChrome}
    >
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.modalScrim, opacity }]}
      />

      <ScrimDismiss
        enabled={!suspendMinimize}
        onDismiss={onMinimize}
        accessibilityLabel={t("action.dismiss")}
      />

      <View
        pointerEvents="box-none"
        style={[
          styles.frame,
          {
            paddingTop: framePadTop,
            paddingBottom: framePadBottom,
            paddingHorizontal: framePadH,
          },
        ]}
      >
        <Animated.View
          accessibilityRole="summary"
          accessibilityLabel={contextTitle ? `${title}. ${contextTitle}` : title}
          style={[
            styles.panel,
            modalShadow,
            {
              backgroundColor: colors.surfaceContainerHigh,
              width: panelWidth,
              height: panelMaxH,
              maxHeight: panelMaxH,
              opacity,
              transform: [{ scale }],
            },
          ]}
        >
          <View style={styles.header}>
            <Icon name="file-manager" size={13} color={colors.onSurfaceVariant} />
            <View style={styles.titles}>
              <Text style={[styles.title, { color: colors.onSurface }]} numberOfLines={1}>
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
                    style={[styles.context, { color: colors.onSurfaceVariant }]}
                    numberOfLines={1}
                  >
                    {contextTitle}
                  </Text>
                </>
              ) : null}
            </View>
            <IconButton
              label={t("modal.file_manager.action.minimize")}
              icon="minus"
              size={16}
              style={styles.chromeBtn}
              onPress={() => {
                if (suspendMinimize) return;
                onMinimize();
              }}
            />
            <IconButton
              label={t("modal.file_manager.action.dismiss")}
              icon="close"
              size={16}
              style={styles.chromeBtn}
              onPress={onDismiss}
            />
          </View>
          <View style={styles.body}>{children}</View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    elevation: 100,
  },
  collapsedHost: {
    position: "absolute",
    width: 0,
    height: 0,
    overflow: "hidden",
    opacity: 0,
  },
  frame: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  panel: {
    borderRadius: radii.lg,
    overflow: "hidden",
    flexDirection: "column",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    minHeight: 36,
    flexShrink: 0,
  },
  chromeBtn: {
    width: 28,
    height: 28,
    minWidth: 28,
    minHeight: 28,
    padding: 0,
  },
  titles: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  title: {
    flexShrink: 0,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 16,
    includeFontPadding: false,
  },
  separator: {
    flexShrink: 0,
    fontSize: 12,
    lineHeight: 16,
    includeFontPadding: false,
  },
  context: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 16,
    includeFontPadding: false,
  },
  body: { flex: 1, minHeight: 0 },
});
