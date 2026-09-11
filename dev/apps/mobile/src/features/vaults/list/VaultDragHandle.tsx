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

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !callbacksRef.current.disabled,
        onStartShouldSetPanResponderCapture: () => !callbacksRef.current.disabled,
        onMoveShouldSetPanResponder: () => !callbacksRef.current.disabled,
        onMoveShouldSetPanResponderCapture: () => !callbacksRef.current.disabled,
        onPanResponderGrant: (event) => {
          callbacksRef.current.onDragStart(event.nativeEvent.pageX, event.nativeEvent.pageY);
        },
        onPanResponderMove: (event) => {
          callbacksRef.current.onDragMove(event.nativeEvent.pageX, event.nativeEvent.pageY);
        },
        onPanResponderRelease: (event) => {
          callbacksRef.current.onDragEnd(event.nativeEvent.pageX, event.nativeEvent.pageY);
        },
        onPanResponderTerminate: () => {
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
