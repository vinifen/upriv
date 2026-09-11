import Svg, { Circle, Path, Rect } from "react-native-svg";
import { ICON_GLYPHS, type IconName, type IconShape } from "@upriv/shared";

/**
 * Same glyph catalog as desktop (`ICON_GLYPHS`), rendered with `react-native-svg`.
 */
export type { IconName };

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
}

function paint(shape: IconShape, color: string) {
  const fill = shape.fill === "current" ? color : "none";
  const stroke = shape.strokeWidth != null ? color : undefined;
  return { fill, stroke, strokeWidth: shape.strokeWidth };
}

function renderShape(shape: IconShape, color: string, key: number) {
  if (shape.kind === "path") {
    const { fill, stroke, strokeWidth } = paint(shape, color);
    return (
      <Path
        key={key}
        d={shape.d}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap={shape.strokeLinecap}
        strokeLinejoin={shape.strokeLinejoin}
        fill={fill}
      />
    );
  }
  if (shape.kind === "circle") {
    const { fill, stroke, strokeWidth } = paint(shape, color);
    return (
      <Circle
        key={key}
        cx={shape.cx}
        cy={shape.cy}
        r={shape.r}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill={fill}
      />
    );
  }
  const { fill, stroke, strokeWidth } = paint(shape, color);
  return (
    <Rect
      key={key}
      x={shape.x}
      y={shape.y}
      width={shape.width}
      height={shape.height}
      rx={shape.rx}
      stroke={stroke}
      strokeWidth={strokeWidth}
      fill={fill}
    />
  );
}

export function Icon({ name, size = 20, color = "currentColor" }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {ICON_GLYPHS[name].map((shape, index) => renderShape(shape, color, index))}
    </Svg>
  );
}
