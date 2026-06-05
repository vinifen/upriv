import { useRef } from "react";
import { useTranslation } from "@/i18n";

interface PaneResizeHandleProps {
  axis: "x" | "y";
  onDrag: (clientPos: number) => void;
}

export function PaneResizeHandle({ axis, onDrag }: PaneResizeHandleProps) {
  const { t } = useTranslation();
  const dragging = useRef(false);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    onDrag(axis === "x" ? event.clientX : event.clientY);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    onDrag(axis === "x" ? event.clientX : event.clientY);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const isColumn = axis === "y";

  return (
    <div
      role="separator"
      aria-orientation={isColumn ? "horizontal" : "vertical"}
      aria-label={t("modal.file_manager.split.resize")}
      aria-valuemin={15}
      aria-valuemax={65}
      tabIndex={0}
      className={[
        "group shrink-0 touch-none select-none",
        isColumn
          ? "h-2 w-full cursor-row-resize md:hidden"
          : "hidden h-full w-2 cursor-col-resize md:block",
      ].join(" ")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className={[
          "bg-outline-variant/0 transition-colors group-hover:bg-outline-variant/25 group-active:bg-outline-variant/40",
          isColumn ? "mx-4 h-full rounded-full" : "my-4 h-full w-full rounded-full",
        ].join(" ")}
      />
    </div>
  );
}
