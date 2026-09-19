import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { GROUP_COLLAPSE_MS, GROUP_EXPAND_MS } from "@upriv/shared";

interface CollapseProps {
  open: boolean;
  children: ReactNode;
  openMs?: number;
  closeMs?: number;
  /**
   * Size the clip box to the children width instead of stretching to the parent.
   * Default body is `left/right: 0` (group rows). Dock chips need shrink-wrap.
   */
  fitContent?: boolean;
}

/**
 * Height expand/collapse for group bodies (New Arch–safe; no LayoutAnimation).
 * Keep real children while mounted — do not empty them when `open` flips false.
 * `overflow: hidden` only while animating (desktop Collapse parity) so shadows
 * and late-growing content can paint once settled.
 */
export function Collapse({
  open,
  children,
  openMs = GROUP_EXPAND_MS,
  closeMs = GROUP_COLLAPSE_MS,
  fitContent = false,
}: CollapseProps) {
  const [mounted, setMounted] = useState(open);
  const [contentH, setContentH] = useState(0);
  const [contentW, setContentW] = useState(0);
  const [settledOpen, setSettledOpen] = useState(false);
  const height = useRef(new Animated.Value(0)).current;
  const openRef = useRef(open);
  openRef.current = open;
  const animGen = useRef(0);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    const gen = ++animGen.current;
    animRef.current?.stop();
    const ease = Easing.out(Easing.cubic);
    if (open) {
      setMounted(true);
      if (contentH <= 0) return;
      const anim = Animated.timing(height, {
        toValue: contentH,
        duration: openMs,
        easing: ease,
        useNativeDriver: false,
      });
      animRef.current = anim;
      anim.start(({ finished }) => {
        if (finished && gen === animGen.current) setSettledOpen(true);
      });
      return;
    }

    setSettledOpen(false);
    const anim = Animated.timing(height, {
      toValue: 0,
      duration: closeMs,
      easing: ease,
      useNativeDriver: false,
    });
    animRef.current = anim;
    anim.start(({ finished }) => {
      if (finished && gen === animGen.current) setMounted(false);
    });
  }, [open, openMs, closeMs, contentH, height]);

  if (!mounted) return null;

  const waitingFirstMeasure = open && contentH <= 0;

  return (
    <Animated.View
      style={[
        waitingFirstMeasure || settledOpen ? styles.unclipped : styles.clip,
        { height },
        fitContent && contentW > 0 ? { width: contentW } : null,
        waitingFirstMeasure ? styles.waitingMeasure : null,
      ]}
      pointerEvents={open ? "auto" : "none"}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? "auto" : "no-hide-descendants"}
    >
      <View
        collapsable={false}
        style={fitContent ? styles.bodyFitContent : styles.body}
        onLayout={(event) => {
          const nextH = Math.round(event.nativeEvent.layout.height);
          const nextW = Math.round(event.nativeEvent.layout.width);
          if (fitContent && nextW > 0 && nextW !== contentW) {
            setContentW(nextW);
          }
          if (nextH <= 0 || nextH === contentH) return;
          const wasMeasured = contentH > 0;
          setContentH(nextH);
          if (!openRef.current) return;
          // Later growth while open: snap. First measure: the open effect animates 0→h.
          if (wasMeasured) height.setValue(nextH);
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: "hidden",
  },
  unclipped: {
    overflow: "visible",
  },
  waitingMeasure: {
    opacity: 0,
  },
  body: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  bodyFitContent: {
    position: "absolute",
    left: 0,
    top: 0,
  },
});
