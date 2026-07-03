import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { menuItemClass, menuPanelClass } from "./menuStyles";

export interface DropdownMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  className?: string;
  onSelect?: () => void;
}

type DropdownTriggerProps = {
  className?: string;
  onClick?: (event: React.MouseEvent) => void;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: "menu" | boolean;
  "aria-controls"?: string;
};

interface DropdownMenuProps {
  trigger: ReactElement<DropdownTriggerProps>;
  items: DropdownMenuItem[];
  align?: "left" | "right";
  label: string;
}

/** One step above row hover (`surface-container-high`) so the trigger stays visible. */
const triggerActiveClass = "bg-surface-container-highest text-on-surface";

const MENU_GAP = 8;

interface MenuPosition {
  top: number;
  left?: number;
  right?: number;
}

export function DropdownMenu({ trigger, items, align = "right", label }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const menuId = useId();

  const updatePosition = useCallback(() => {
    const anchor = rootRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const top = rect.bottom + MENU_GAP;
    if (align === "right") {
      setPosition({ top, right: window.innerWidth - rect.right });
    } else {
      setPosition({ top, left: rect.left });
    }
  }, [align]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onReflow = () => updatePosition();

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, updatePosition]);

  const enhancedTrigger = isValidElement(trigger)
    ? cloneElement(trigger, {
        "aria-expanded": open,
        "aria-haspopup": "menu" as const,
        "aria-controls": menuId,
        className: [trigger.props.className, open ? triggerActiveClass : ""]
          .filter(Boolean)
          .join(" "),
        onClick: (event: React.MouseEvent) => {
          trigger.props.onClick?.(event);
          event.stopPropagation();
          setOpen((prev) => !prev);
        },
      })
    : trigger;

  return (
    <div ref={rootRef} className="relative">
      {enhancedTrigger}
      {open && position
        ? createPortal(
            <ul
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={label}
              style={{
                position: "fixed",
                top: position.top,
                left: position.left,
                right: position.right,
              }}
              className={["z-[120] min-w-[12rem]", menuPanelClass].join(" ")}
              onClick={(event) => event.stopPropagation()}
            >
              {items.map((item) => (
                <li key={item.id} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className={[menuItemClass, item.className].filter(Boolean).join(" ")}
                    onClick={() => {
                      item.onSelect?.();
                      setOpen(false);
                    }}
                  >
                    {item.icon ? (
                      <span className="text-on-surface-variant">{item.icon}</span>
                    ) : null}
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}
