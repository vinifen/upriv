import { VAULT_LIST_DRAG_THRESHOLD_PX } from "@upriv/shared";
import { useMemo, useRef } from "react";
import { PanResponder, StyleSheet, View } from "react-native";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { radii } from "@/theme/tokens";

interface VaultDragHandleProps {
  disabled?: boolean;
  label?: string;
  onDragStart: (pageX: number, pageY: number) => void;
  onDragMove: (pageX: number, pageY: number) => void;
  onDragEnd: (pageX: number, pageY: number) => void;
  onDragCancel: () => void;
}

/** Grip control — desktop `VaultDragHandle` parity via pan (no HTML5 DnD). */
export function VaultDragHandle({
  disabled = false,
  label,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: VaultDragHandleProps) {
  const { t } = useTranslation();
  const handleLabel = label ?? t("action.drag_reorder");
  const { colors } = useTheme();
  const callbacksRef = useRef({ disabled, onDragStart, onDragMove, onDragEnd, onDragCancel });
  callbacksRef.current = { disabled, onDragStart, onDragMove, onDragEnd, onDragCancel };
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !callbacksRef.current.disabled,
        onStartShouldSetPanResponderCapture: () => !callbacksRef.current.disabled,
        onMoveShouldSetPanResponder: () => !callbacksRef.current.disabled,
        onMoveShouldSetPanResponderCapture: () => !callbacksRef.current.disabled,
        onPanResponderGrant: (event) => {
          originRef.current = {
            x: event.nativeEvent.pageX,
            y: event.nativeEvent.pageY,
          };
          draggingRef.current = false;
        },
        onPanResponderMove: (event) => {
          const origin = originRef.current;
          if (!origin) return;
          const pageX = event.nativeEvent.pageX;
          const pageY = event.nativeEvent.pageY;
          if (!draggingRef.current) {
            const dx = pageX - origin.x;
            const dy = pageY - origin.y;
            if (dx * dx + dy * dy < VAULT_LIST_DRAG_THRESHOLD_PX * VAULT_LIST_DRAG_THRESHOLD_PX) {
              return;
            }
            draggingRef.current = true;
            callbacksRef.current.onDragStart(pageX, pageY);
          }
          callbacksRef.current.onDragMove(pageX, pageY);
        },
        onPanResponderRelease: (event) => {
          originRef.current = null;
          if (!draggingRef.current) return;
          draggingRef.current = false;
          callbacksRef.current.onDragEnd(event.nativeEvent.pageX, event.nativeEvent.pageY);
        },
        onPanResponderTerminate: () => {
          originRef.current = null;
          if (!draggingRef.current) return;
          draggingRef.current = false;
          callbacksRef.current.onDragCancel();
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    [],
  );

  return (
    <View
      {...pan.panHandlers}
      accessibilityRole="button"
      accessibilityLabel={handleLabel}
      accessibilityState={{ disabled }}
      collapsable={false}
      style={[styles.handle, disabled ? styles.disabled : null]}
    >
      <Icon name="grip-vertical" size={18} color={colors.onSurfaceVariant} />
    </View>
  );
}

const styles = StyleSheet.create({
  handle: {
    width: 32,
    height: 40,
    marginRight: -8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
  },
  disabled: { opacity: 0.35 },
});
