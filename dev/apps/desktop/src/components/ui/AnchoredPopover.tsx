import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

/** Below Modal (`z-[100]`), above vault/group cards. */
export const ANCHORED_MENU_Z_INDEX = 90;
const GAP_PX = 8;

function menuStyle(
  trigger: DOMRect,
  align: "left" | "right",
  matchTriggerWidth: boolean,
): CSSProperties {
  const style: CSSProperties = {
    position: "fixed",
    top: trigger.bottom + GAP_PX,
    zIndex: ANCHORED_MENU_Z_INDEX,
  };
  if (matchTriggerWidth) {
    style.left = trigger.left;
    style.width = trigger.width;
    return style;
  }
  if (align === "right") {
    style.right = Math.max(8, window.innerWidth - trigger.right);
  } else {
    style.left = Math.max(8, trigger.left);
  }
  return style;
}

interface AnchoredPopoverProps {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  align?: "left" | "right";
  /** Stretch to the trigger width (split Lock/Unlock chevron menu). */
  matchTriggerWidth?: boolean;
  id?: string;
  role?: string;
  "aria-label"?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * Dropdown surface on `document.body` so vault/group stacking cannot cover it.
 */
export function AnchoredPopover({
  open,
  onClose,
  triggerRef,
  align = "right",
  matchTriggerWidth = false,
  id,
  role,
  "aria-label": ariaLabel,
  className,
  style: styleProp,
  children,
}: AnchoredPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const el = triggerRef.current;
      if (!el) return;
      setStyle(menuStyle(el.getBoundingClientRect(), align, matchTriggerWidth));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [align, matchTriggerWidth, open, triggerRef]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open, triggerRef]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role={role}
      aria-label={ariaLabel}
      style={{ ...style, ...styleProp }}
      className={className}
    >
      {children}
    </div>,
    document.body,
  );
}
