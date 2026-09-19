import { VAULT_LIST_DRAG_THRESHOLD_PX } from "@upriv/shared";
import { useRef, type PointerEvent } from "react";
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

function movedPastThreshold(origin: { x: number; y: number }, x: number, y: number): boolean {
  const dx = x - origin.x;
  const dy = y - origin.y;
  return dx * dx + dy * dy >= VAULT_LIST_DRAG_THRESHOLD_PX * VAULT_LIST_DRAG_THRESHOLD_PX;
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
  const originRef = useRef<{ x: number; y: number } | null>(null);
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

  const releasePointer = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
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
        originRef.current = { x: event.clientX, y: event.clientY };
        draggingRef.current = false;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const origin = originRef.current;
        if (!origin) return;
        event.preventDefault();
        if (!draggingRef.current) {
          if (!movedPastThreshold(origin, event.clientX, event.clientY)) return;
          draggingRef.current = true;
          callbacksRef.current.onPointerDragStart(
            callbacksRef.current.dropKey,
            event.clientX,
            event.clientY,
          );
        }
        callbacksRef.current.onPointerDragMove(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        if (!originRef.current) return;
        originRef.current = null;
        event.preventDefault();
        releasePointer(event);
        if (!draggingRef.current) return;
        draggingRef.current = false;
        callbacksRef.current.onPointerDragEnd(event.clientX, event.clientY);
      }}
      onPointerCancel={(event) => {
        originRef.current = null;
        releasePointer(event);
        if (!draggingRef.current) return;
        draggingRef.current = false;
        callbacksRef.current.onPointerDragCancel();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <Icon name="grip-vertical" size={18} className="pointer-events-none" />
    </div>
  );
}
