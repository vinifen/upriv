import { useRef, useState } from "react";
import { TREE_SPLIT_MAX_PERCENT, TREE_SPLIT_MIN_PERCENT } from "@upriv/shared";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";

interface PaneResizeHandleProps {
  axis: "x" | "y";
  /** Canonical split percent (15–65). */
  value: number;
  onDragStart?: () => void;
  /** Pixel delta from the grab point (not the pointer's absolute position). */
  onDrag: (deltaPx: number) => void;
  onDragEnd?: () => void;
  onNudge: (nextCanonical: number) => void;
}

export function PaneResizeHandle({
  axis,
  value,
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
    const step = event.shiftKey ? 5 : 1;
    let next: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = value - step;
    else if (event.key === "ArrowRight" || event.key === "ArrowDown") next = value + step;
    else if (event.key === "Home") next = TREE_SPLIT_MIN_PERCENT;
    else if (event.key === "End") next = TREE_SPLIT_MAX_PERCENT;
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

  return (
    <div
      role="separator"
      aria-orientation={isColumn ? "horizontal" : "vertical"}
      aria-label={t("modal.file_manager.split.resize")}
      aria-valuemin={TREE_SPLIT_MIN_PERCENT}
      aria-valuemax={TREE_SPLIT_MAX_PERCENT}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      className={[
        "group relative z-[1] flex shrink-0 touch-none select-none items-center justify-center gap-1",
        isColumn ? "h-2 w-full cursor-row-resize" : "h-full w-2 cursor-col-resize",
        isColumn ? "flex-row" : "flex-col",
      ].join(" ")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onKeyDown={onKeyDown}
    >
      {/* Two segments — line never runs through the grip. */}
      <div
        aria-hidden
        className={[
          "pointer-events-none min-h-0 min-w-0 flex-1 rounded-full transition-colors",
          isColumn ? "h-px" : "w-px",
          lineTone,
        ].join(" ")}
      />
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
      <div
        aria-hidden
        className={[
          "pointer-events-none min-h-0 min-w-0 flex-1 rounded-full transition-colors",
          isColumn ? "h-px" : "w-px",
          lineTone,
        ].join(" ")}
      />
    </div>
  );
}
