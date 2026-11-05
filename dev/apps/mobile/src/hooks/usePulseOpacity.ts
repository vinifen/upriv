import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Easing } from "react-native";

/**
 * Desktop `animate-pulse`: opacity 1 → 0.5 → 1 every 2 s while `active`.
 * Stays at 1 with Reduce Motion, and returns to 1 when `active` turns off.
 *
 * A stopped native animation reports where it stopped after the stop call
 * returns, and writes that opacity onto the view. The reset to 1 waits for
 * that report, so a badge or button never keeps a half-faded look.
 */
export function usePulseOpacity(active = true): Animated.Value {
  const pulse = useRef(new Animated.Value(1)).current;
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!active) return;
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    const step = (toValue: number) =>
      Animated.timing(pulse, {
        toValue,
        duration: 1000,
        easing: Easing.bezier(0.4, 0, 0.6, 1),
        useNativeDriver: true,
      });
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled || reduce) return;
      loop = Animated.loop(Animated.sequence([step(0.5), step(1)]));
      loop.start();
    });
    return () => {
      cancelled = true;
      if (!loop) return;
      loop.stop();
      pulse.stopAnimation(() => {
        // Turned on again meanwhile: the new loop runs from here.
        if (!activeRef.current) pulse.setValue(1);
      });
    };
  }, [active, pulse]);

  return pulse;
}
