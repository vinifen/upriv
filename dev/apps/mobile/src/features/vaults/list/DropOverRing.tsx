import { StyleSheet, View } from "react-native";
import { hexWithAlpha } from "@upriv/shared";
import { radii } from "@/theme/tokens";

const VALID_ALPHA = 0.4;
/** Inner RN border reads hotter than desktop outline. */
const BLOCKED_ALPHA = 0.28;

/** Same 2px mix as desktop `vault-list-drop-over`. */
export function DropOverRing({
  visible,
  blocked,
  accent,
  recovery,
}: {
  visible: boolean;
  blocked: boolean;
  accent: string;
  recovery: string;
}) {
  if (!visible) return null;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.ring,
        {
          borderColor: hexWithAlpha(
            blocked ? recovery : accent,
            blocked ? BLOCKED_ALPHA : VALID_ALPHA,
          ),
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  ring: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    borderRadius: radii.md,
    borderWidth: 2,
  },
});
