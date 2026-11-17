import { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import { GROUP_COLLAPSE_MS, GROUP_EXPAND_MS } from "@upriv/shared";
import { Icon } from "@/components/icons";

/**
 * The chevron of a section that opens in place: down while open, turned to
 * point right while closed, at the speed of the section's own `Collapse`
 * (desktop `DisclosureChevron` parity).
 */
export function DisclosureChevron({
  open,
  color,
  size = 18,
}: {
  open: boolean;
  color: string;
  size?: number;
}) {
  const rotation = useRef(new Animated.Value(open ? 0 : 1)).current;

  useEffect(() => {
    Animated.timing(rotation, {
      toValue: open ? 0 : 1,
      duration: open ? GROUP_EXPAND_MS : GROUP_COLLAPSE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open, rotation]);

  const rotate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "-90deg"],
  });

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Icon name="chevron-down" size={size} color={color} />
    </Animated.View>
  );
}
