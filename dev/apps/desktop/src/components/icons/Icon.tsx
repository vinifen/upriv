import type { ReactNode, SVGAttributes } from "react";
import { ICON_GLYPHS, type IconName, type IconShape } from "@upriv/shared";

export type { IconName };

function paint(shape: IconShape, color: string) {
  const fill = shape.fill === "current" ? color : "none";
  const stroke = shape.strokeWidth != null ? color : undefined;
  return { fill, stroke, strokeWidth: shape.strokeWidth };
}

function renderShape(shape: IconShape, color: string, key: number): ReactNode {
  if (shape.kind === "path") {
    const { fill, stroke, strokeWidth } = paint(shape, color);
    return (
      <path
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
      <circle
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
    <rect
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

export interface IconProps extends SVGAttributes<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 20, className = "", ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      {...props}
    >
      {ICON_GLYPHS[name].map((shape, index) => renderShape(shape, "currentColor", index))}
    </svg>
  );
}
