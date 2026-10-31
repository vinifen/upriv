import { StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";

/** Wider than any one-line label; only the text's own width is read. */
const PROBE_ROOM = 4000;

interface TextWidthProbeProps {
  text: string;
  style: StyleProp<TextStyle>;
  onWidth: (width: number) => void;
}

/** Reports how wide `text` is on one line, uncut. Draws nothing. */
export function TextWidthProbe({ text, style, onWidth }: TextWidthProbeProps) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.probe}
    >
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={style}
        onLayout={(event) => onWidth(event.nativeEvent.layout.width)}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  probe: {
    position: "absolute",
    left: 0,
    top: 0,
    width: PROBE_ROOM,
    flexDirection: "row",
    opacity: 0,
  },
});
