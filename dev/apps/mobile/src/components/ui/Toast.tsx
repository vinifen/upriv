import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Modal as RnModal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ToastState } from "@upriv/shared/react";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme/ThemeContext";
import { modalShadow, radii, spacing } from "@/theme/tokens";

interface ToastProps {
  toast: ToastState | null;
  onDismiss: () => void;
  /** Extra lift above the default safe-area offset (file-manager dock). */
  bottomExtra?: number;
}

/** Time left before auto-dismiss: a line that shrinks toward the left edge. */
function ToastProgress({ durationMs, color }: { durationMs: number; color: string }) {
  const remaining = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const run = Animated.timing(remaining, {
      toValue: 0,
      duration: durationMs,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    run.start();
    return () => run.stop();
  }, [durationMs, remaining]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.progress,
        {
          backgroundColor: color,
          width: remaining.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
        },
      ]}
    />
  );
}

/** Bottom toast — desktop `Toast` parity (message + close + time-left line). */
export function Toast({ toast, onDismiss, bottomExtra = 0 }: ToastProps) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  if (!toast) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { bottom: Math.max(insets.bottom, spacing.md) + spacing.md + bottomExtra },
      ]}
    >
      <View
        style={[
          styles.toast,
          modalShadow,
          {
            backgroundColor: colors.surfaceContainerHigh,
            borderColor: colors.outlineVariant,
          },
        ]}
        accessibilityRole="alert"
      >
        <Text style={[typography.body, styles.text, { color: colors.onSurface }]}>
          {toast.message}
        </Text>
        <Pressable
          onPress={onDismiss}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("action.close")}
          style={styles.close}
        >
          <Icon name="close" size={16} color={colors.onSurfaceVariant} />
        </Pressable>
        {toast.durationMs > 0 ? (
          <ToastProgress key={toast.id} durationMs={toast.durationMs} color={colors.accent} />
        ) : null}
      </View>
    </View>
  );
}

/** `Toast` in its own window, for callers that are not inside a `Modal` with an `overlay`. */
export function FloatingToast({ toast, onDismiss }: Omit<ToastProps, "bottomExtra">) {
  if (!toast) return null;
  return (
    <RnModal transparent visible animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.floatingHost} pointerEvents="box-none">
        <Toast toast={toast} onDismiss={onDismiss} />
      </View>
    </RnModal>
  );
}

const styles = StyleSheet.create({
  floatingHost: { flex: 1 },
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 300,
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    overflow: "hidden",
    borderRadius: radii.md,
    borderWidth: 1,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: spacing.md,
    maxWidth: 448,
    width: "100%",
  },
  text: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    lineHeight: 20,
  },
  close: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  progress: {
    position: "absolute",
    left: 0,
    bottom: 0,
    height: 2,
  },
});
