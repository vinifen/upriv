import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/icons";
import { placeAnchoredMenu } from "@upriv/shared";
import { MenuPanelHeader } from "./MenuPanelHeader";
import { menuItemClass, menuPanelClass } from "./menuStyles";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon: IconName;
  onSelect: () => void;
  danger?: boolean;
}

interface ContextMenuProps {
  /** Pointer position (client coordinates) where the menu opens. */
  x: number;
  y: number;
  title: string;
  items: ContextMenuItem[];
  onClose: () => void;
}

/** Right-click menu at the pointer. Selecting an item closes the menu first. */
export function ContextMenu({ x, y, title, items, onClose }: ContextMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const spaceRight = window.innerWidth - pad - x;
    const next = placeAnchoredMenu({
      anchor: { x, y, width: 1, height: 1 },
      panelWidth: rect.width,
      panelHeight: rect.height,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      padding: { top: pad, right: pad, bottom: pad, left: pad },
      gap: 0,
      align: spaceRight < rect.width ? "right" : "left",
    });
    setPlaced({ left: next.left, top: next.top });
  }, [x, y, items.length, title]);

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[120]"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={panelRef}
        className={[menuPanelClass, "fixed z-[121] w-max min-w-[12rem] max-w-[15rem] py-1"].join(
          " ",
        )}
        style={{
          left: placed?.left ?? x,
          top: placed?.top ?? y,
          visibility: placed ? "visible" : "hidden",
        }}
        role="menu"
        aria-label={title}
      >
        <MenuPanelHeader title={title} onClose={onClose} />
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={[menuItemClass, item.danger ? "!text-on-error-container" : ""].join(" ")}
            style={item.danger ? { color: "var(--on-error-container)" } : undefined}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <Icon
              name={item.icon}
              size={16}
              className="shrink-0"
              style={
                item.danger
                  ? { color: "var(--on-error-container)" }
                  : { color: "var(--on-surface-variant)" }
              }
            />
            <span className="min-w-0 truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}
