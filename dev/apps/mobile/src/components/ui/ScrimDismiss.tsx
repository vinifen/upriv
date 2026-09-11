import { useCallback, useRef } from "react";
import { StyleSheet, View, type GestureResponderEvent } from "react-native";

const TAP_SLOP_PX = 16;

function touchMovedFrom(
  start: { x: number; y: number } | null,
  event: GestureResponderEvent,
): boolean {
  if (!start) return false;
  const dx = event.nativeEvent.pageX - start.x;
  const dy = event.nativeEvent.pageY - start.y;
  return dx * dx + dy * dy > TAP_SLOP_PX * TAP_SLOP_PX;
}

/**
 * Fire `onTap` on touch end only when the finger did not pan.
 * Dialog body: a scroll must not dismiss a footer confirm (desktop wheel).
 */
export function useTapNotPan(onTap: () => void, enabled: boolean) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;

  const onTouchStart = useCallback((event: GestureResponderEvent) => {
    start.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
    moved.current = false;
  }, []);

  const onTouchMove = useCallback((event: GestureResponderEvent) => {
    if (touchMovedFrom(start.current, event)) moved.current = true;
  }, []);

  const onTouchEnd = useCallback(() => {
    const tap = Boolean(start.current) && !moved.current;
    start.current = null;
    moved.current = false;
    if (tap) onTapRef.current();
  }, []);

  const onTouchCancel = useCallback(() => {
    start.current = null;
    moved.current = false;
  }, []);

  if (!enabled) return undefined;
  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel };
}

interface ScrimDismissProps {
  onDismiss: () => void;
  /** When false, still eat pans so they cannot leak through a transparent Modal. */
  enabled?: boolean;
  accessibilityLabel: string;
}

/**
 * Full-screen catcher: tap dismisses, pan does not.
 * Owns the responder — Pressable `onPress` is the press-in point on RN, so a
 * fling on the dimmer looked like a tap and closed short dialogs.
 */
export function ScrimDismiss({ onDismiss, enabled = true, accessibilityLabel }: ScrimDismissProps) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  const grant = (event: GestureResponderEvent) => {
    start.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
    moved.current = false;
  };

  const move = (event: GestureResponderEvent) => {
    if (touchMovedFrom(start.current, event)) moved.current = true;
  };

  const release = () => {
    const tap = Boolean(start.current) && !moved.current;
    start.current = null;
    moved.current = false;
    if (enabled && tap) onDismiss();
  };

  const cancel = () => {
    start.current = null;
    moved.current = false;
  };

  return (
    <View
      style={StyleSheet.absoluteFill}
      collapsable={false}
      accessible={enabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={grant}
      onResponderMove={move}
      onResponderRelease={release}
      onResponderTerminate={cancel}
    />
  );
}
