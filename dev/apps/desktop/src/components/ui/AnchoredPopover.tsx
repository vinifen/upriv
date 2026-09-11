import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { isTriggerOccluded, placeAnchoredMenu } from "@upriv/shared";

/** Below Modal (`z-[100]`), above vault/group cards. */
const ANCHORED_MENU_Z_INDEX = 90;
const DEFAULT_GAP_PX = 8;
const EDGE_PX = 8;
const PANEL_HEIGHT_ESTIMATE = 240;

interface AnchoredPopoverProps {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  align?: "left" | "right";
  /** Stretch to the trigger width (split Lock/Unlock chevron menu). */
  matchTriggerWidth?: boolean;
  /** Distance from the trigger. `0` / negative sits flush (Select). Default 8 (menus). */
  gap?: number;
  id?: string;
  role?: string;
  "aria-label"?: string;
  className?: string;
  style?: CSSProperties;
  /** Above modal overlays (`z-[100]` / `z-[200]`). */
  zIndex?: number;
  onSideChange?: (side: "below" | "above") => void;
  children: ReactNode;
}

function sameBox(prev: CSSProperties | null, next: CSSProperties): boolean {
  return Boolean(
    prev &&
    prev.top === next.top &&
    prev.left === next.left &&
    prev.width === next.width &&
    prev.minWidth === next.minWidth &&
    prev.maxWidth === next.maxWidth &&
    prev.maxHeight === next.maxHeight &&
    prev.height === next.height &&
    prev.overflowY === next.overflowY,
  );
}

function overflowClipRects(el: HTMLElement) {
  const rects: { top: number; right: number; bottom: number; left: number }[] = [];
  let parent = el.parentElement;
  while (parent) {
    const overflowY = getComputedStyle(parent).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      parent.scrollHeight > parent.clientHeight + 1
    ) {
      const box = parent.getBoundingClientRect();
      rects.push({ top: box.top, right: box.right, bottom: box.bottom, left: box.left });
    }
    parent = parent.parentElement;
  }
  return rects;
}

/**
 * Dropdown surface on `document.body` so vault/group stacking cannot cover it.
 * Opens above or below the trigger — same placement as mobile.
 */
export function AnchoredPopover({
  open,
  onClose,
  triggerRef,
  align = "right",
  matchTriggerWidth = false,
  gap = DEFAULT_GAP_PX,
  id,
  role,
  "aria-label": ariaLabel,
  className,
  style: styleProp,
  zIndex = ANCHORED_MENU_Z_INDEX,
  onSideChange,
  children,
}: AnchoredPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onSideChangeRef = useRef(onSideChange);
  onSideChangeRef.current = onSideChange;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const catcherStart = useRef<{ x: number; y: number } | null>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }

    const update = () => {
      const el = triggerRef.current;
      const panel = panelRef.current;
      if (!el) return;
      const trigger = el.getBoundingClientRect();
      if (
        isTriggerOccluded(
          { top: trigger.top, right: trigger.right, bottom: trigger.bottom, left: trigger.left },
          overflowClipRects(el),
          { width: window.innerWidth, height: window.innerHeight },
          EDGE_PX,
        )
      ) {
        queueMicrotask(() => onCloseRef.current());
        return;
      }
      const contentHeight =
        panel && panel.scrollHeight > 0 ? panel.scrollHeight : PANEL_HEIGHT_ESTIMATE;
      const maxWidth = window.innerWidth - EDGE_PX * 2;
      const measuredPanelW = panel && panel.offsetWidth > 0 ? panel.offsetWidth : 224;
      // Attached Select (gap -1) only lines up if the panel cannot outgrow the trigger.
      const panelWidth = Math.min(
        maxWidth,
        matchTriggerWidth ? Math.max(1, trigger.width) : measuredPanelW,
      );
      const placed = placeAnchoredMenu({
        anchor: {
          x: trigger.left,
          y: trigger.top,
          width: trigger.width,
          height: trigger.height,
        },
        panelWidth,
        panelHeight: contentHeight,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        padding: { top: EDGE_PX, right: EDGE_PX, bottom: EDGE_PX, left: EDGE_PX },
        gap,
        align,
      });
      onSideChangeRef.current?.(placed.side);
      const overflows = contentHeight > placed.maxHeight + 1;
      const next: CSSProperties = {
        position: "absolute",
        top: Math.round(placed.top),
        left: Math.round(placed.left),
        width: matchTriggerWidth ? Math.round(panelWidth) : undefined,
        minWidth: matchTriggerWidth ? Math.round(panelWidth) : undefined,
        maxWidth: Math.round(maxWidth),
        // Hug the options so the trigger stays attached — maxHeight is a cap, not a size.
        height: overflows ? Math.round(placed.maxHeight) : "fit-content",
        maxHeight: Math.round(placed.maxHeight),
        overflowY: overflows ? "auto" : "visible",
      };
      setStyle((prev) => (sameBox(prev, next) ? prev : next));
    };

    const onScroll = (event: Event) => {
      const target = event.target;
      const panel = panelRef.current;
      if (target instanceof Node && panel && (target === panel || panel.contains(target))) {
        return;
      }
      update();
    };

    update();
    window.addEventListener("resize", update);
    document.addEventListener("scroll", onScroll, true);
    const panel = panelRef.current;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => update()) : null;
    if (panel && ro) ro.observe(panel);
    return () => {
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", onScroll, true);
      ro?.disconnect();
    };
  }, [align, gap, matchTriggerWidth, open, triggerRef, zIndex]);

  useEffect(() => {
    if (!open) return;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      onCloseRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, triggerRef]);

  const dismissOnCatcher = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const start = catcherStart.current;
    catcherStart.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (dx * dx + dy * dy <= 100) onCloseRef.current();
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex,
        pointerEvents: "none",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "auto",
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          catcherStart.current = { x: event.clientX, y: event.clientY };
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={dismissOnCatcher}
      />
      <div
        ref={panelRef}
        id={id}
        role={role}
        aria-label={ariaLabel}
        style={{
          position: "absolute",
          zIndex: 1,
          ...(style ?? { top: 0, left: 0 }),
          visibility: style ? "visible" : "hidden",
          pointerEvents: style ? "auto" : "none",
          ...styleProp,
        }}
        className={className}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
