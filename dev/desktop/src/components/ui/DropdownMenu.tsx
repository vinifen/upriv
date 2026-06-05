import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
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
const triggerActiveClass =
  "bg-surface-container-highest text-on-surface";

export function DropdownMenu({ trigger, items, align = "right", label }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const enhancedTrigger = isValidElement(trigger)
    ? cloneElement(trigger, {
        "aria-expanded": open,
        "aria-haspopup": "menu" as const,
        "aria-controls": menuId,
        className: [trigger.props.className, open ? triggerActiveClass : ""].filter(Boolean).join(" "),
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
      {open ? (
        <ul
          id={menuId}
          role="menu"
          aria-label={label}
          className={[
            "absolute z-50 mt-2 min-w-[12rem]",
            menuPanelClass,
            align === "right" ? "right-0" : "left-0",
          ].join(" ")}
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
        </ul>
      ) : null}
    </div>
  );
}
