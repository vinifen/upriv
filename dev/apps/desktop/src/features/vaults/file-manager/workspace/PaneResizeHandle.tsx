import { useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";

interface PaneResizeHandleProps {
  axis: "x" | "y";
  /** Size of the pane this divider sets, within `min`–`max` (Home and End go there). */
  value: number;
  min: number;
  max: number;
  /** Arrow-key step; Shift moves five. */
  step?: number;
  /**
   * Where that pane sits: `before` the divider (the explorer), so moving right
   * or down grows it, or `after` it (the outline), so moving left grows it.
   */
  sizes?: "before" | "after";
  /** Accessible name; the explorer divider's by default. */
  label?: string;
  /** Straddles the border it sits on and takes no room of its own (the outline's). */
  overlay?: boolean;
  onDragStart?: () => void;
  /** Pixel delta from the grab point (not the pointer's absolute position). */
  onDrag: (deltaPx: number) => void;
  onDragEnd?: () => void;
  onNudge: (next: number) => void;
}

export function PaneResizeHandle({
  axis,
  value,
  min,
  max,
  step = 1,
  sizes = "before",
  label,
  overlay = false,
  onDragStart,
  onDrag,
  onDragEnd,
  onNudge,
}: PaneResizeHandleProps) {
  const { t } = useTranslation();
  const dragging = useRef(false);
  const startPos = useRef(0);
  const [active, setActive] = useState(false);

  const pointerPos = (event: React.PointerEvent<HTMLDivElement>) =>
    axis === "x" ? event.clientX : event.clientY;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    dragging.current = true;
    startPos.current = pointerPos(event);
    setActive(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    onDragStart?.();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    if (event.pointerType === "mouse" && event.buttons === 0) return;
    onDrag(pointerPos(event) - startPos.current);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    setActive(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
    onDragEnd?.();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const move = (event.shiftKey ? 5 : 1) * step * (sizes === "after" ? -1 : 1);
    let next: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = value - move;
    else if (event.key === "ArrowRight" || event.key === "ArrowDown") next = value + move;
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    if (next === null) return;
    event.preventDefault();
    onNudge(next);
  };

  const isColumn = axis === "y";
  const iconSize = isColumn ? 14 : 12;
  /** Idle: line + grip invisible (hit size unchanged). Visible on hover / focus / drag. */
  const lineTone = active
    ? "bg-accent"
    : [
        "bg-transparent",
        "group-hover:bg-[color-mix(in_srgb,var(--accent)_70%,transparent)]",
        "group-focus-visible:bg-[color-mix(in_srgb,var(--accent)_70%,transparent)]",
      ].join(" ");
  const iconTone = active
    ? "text-accent opacity-100"
    : [
        "text-transparent opacity-0",
        "group-hover:text-[color-mix(in_srgb,var(--accent)_70%,transparent)] group-hover:opacity-100",
        "group-focus-visible:text-[color-mix(in_srgb,var(--accent)_70%,transparent)] group-focus-visible:opacity-100",
      ].join(" ");
  const segment = (
    <div
      aria-hidden
      className={[
        "pointer-events-none min-h-0 min-w-0 flex-1 rounded-full transition-colors",
        isColumn ? "h-px" : "w-px",
        lineTone,
      ].join(" ")}
    />
  );

  return (
    <div
      role="separator"
      aria-orientation={isColumn ? "horizontal" : "vertical"}
      aria-label={label ?? t("modal.file_manager.split.resize")}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      className={[
        "group relative z-[1] flex shrink-0 touch-none select-none items-center justify-center gap-1",
        isColumn ? "h-2 w-full cursor-row-resize" : "h-full w-2 cursor-col-resize",
        isColumn ? "flex-row" : "flex-col",
        overlay ? (isColumn ? "-my-1" : "-mx-1") : "",
      ].join(" ")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onKeyDown={onKeyDown}
    >
      {/* Two segments — line never runs through the grip. */}
      {segment}
      <Icon
        name="grip-vertical"
        size={iconSize}
        aria-hidden
        className={[
          "pointer-events-none relative shrink-0 bg-transparent transition-colors",
          isColumn ? "rotate-90" : "",
          iconTone,
        ].join(" ")}
      />
      {segment}
    </div>
  );
}
