import { View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";

interface UprivWordmarkProps {
  /** Rendered height in dp (desktop header uses ~20 on compact). */
  height?: number;
  style?: StyleProp<ViewStyle>;
}

/** Intrinsic SVG aspect: 300×72. Content ink ends near x≈255. */
const VB_W = 300;
const VB_H = 72;

/**
 * Upriv wordmark (same paths as desktop `Upriv-wordmark-*.svg`).
 * White on dark/neutral; navy on light.
 */
export function UprivWordmark({ height = 20, style }: UprivWordmarkProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const width = Math.round((VB_W / VB_H) * height);
  const ink = theme === "light" ? "#0B0E1E" : "#ffffff";

  return (
    <View
      style={[{ width, height, flexShrink: 0 }, style]}
      accessible
      accessibilityRole="header"
      accessibilityLabel={t("app.title")}
    >
      <Svg
        width={width}
        height={height}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMinYMid meet"
      >
        <G fill="none" stroke={ink} strokeWidth={11} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M 17 17 L 5 17" />
          <Path d="M 17 17 L 17 51 Q 17 64 31.5 64 Q 46 64 46 51 L 46 17" />
          <Path d="M 70 17 L 70 63" />
          <Path d="M 70 30 Q 70 17 88 17 Q 106 17 106 35 Q 106 53 88 53 Q 70 53 70 35" />
          <Path d="M 124 17 L 124 63 M 124 30 L 144 30" />
          <Circle cx={168} cy={11} r={5.5} fill={ink} stroke="none" />
          <Path d="M 168 24 L 168 63" />
          <Path d="M 198 17 L 213.5 55 Q 217 63 223 63 Q 229 63 232.5 55 L 248 17" />
        </G>
      </Svg>
    </View>
  );
}
