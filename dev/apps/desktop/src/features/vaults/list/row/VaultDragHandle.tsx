import { useRef } from "react";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";

interface VaultDragHandleProps {
  disabled?: boolean;
  dropKey: string;
  label?: string;
  onPointerDragStart: (key: string, clientX: number, clientY: number) => void;
  onPointerDragMove: (clientX: number, clientY: number) => void;
  onPointerDragEnd: (clientX: number, clientY: number) => void;
  onPointerDragCancel: () => void;
}

/** Grip — pointer drag (mobile parity; HTML5 DnD is unreliable in Electron nested groups). */
export function VaultDragHandle({
  disabled = false,
  dropKey,
  label,
  onPointerDragStart,
  onPointerDragMove,
  onPointerDragEnd,
  onPointerDragCancel,
}: VaultDragHandleProps) {
  const { t } = useTranslation();
  const handleLabel = label ?? t("action.drag_reorder");
  const draggingRef = useRef(false);
  const callbacksRef = useRef({
    dropKey,
    onPointerDragStart,
    onPointerDragMove,
    onPointerDragEnd,
    onPointerDragCancel,
  });
  callbacksRef.current = {
    dropKey,
    onPointerDragStart,
    onPointerDragMove,
    onPointerDragEnd,
    onPointerDragCancel,
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={handleLabel}
      title={handleLabel}
      className={[
        "vault-drag-handle flex h-10 w-8 shrink-0 items-center justify-center rounded-lg -mr-2 touch-none select-none",
        "text-on-surface-variant transition-colors",
        disabled
          ? "cursor-not-allowed opacity-35"
          : "cursor-grab hover:bg-surface-container-highest hover:text-on-surface active:cursor-grabbing",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      ].join(" ")}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        draggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        callbacksRef.current.onPointerDragStart(
          callbacksRef.current.dropKey,
          event.clientX,
          event.clientY,
        );
      }}
      onPointerMove={(event) => {
        if (!draggingRef.current) return;
        event.preventDefault();
        callbacksRef.current.onPointerDragMove(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        event.preventDefault();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        callbacksRef.current.onPointerDragEnd(event.clientX, event.clientY);
      }}
      onPointerCancel={(event) => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        callbacksRef.current.onPointerDragCancel();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <Icon name="grip-vertical" size={18} className="pointer-events-none" />
    </div>
  );
}
