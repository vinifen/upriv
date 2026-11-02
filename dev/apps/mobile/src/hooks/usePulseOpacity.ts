import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Easing } from "react-native";

/**
 * Desktop `animate-pulse`: opacity 1 → 0.5 → 1 every 2 s while `active`.
 * Stays at 1 with Reduce Motion, and returns to 1 when `active` turns off.
 */
export function usePulseOpacity(active = true): Animated.Value {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active) {
      pulse.setValue(1);
      return;
    }
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
      loop?.stop();
      pulse.setValue(1);
    };
  }, [active, pulse]);

  return pulse;
}
