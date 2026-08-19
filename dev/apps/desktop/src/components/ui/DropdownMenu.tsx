import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import { AnchoredPopover } from "./AnchoredPopover";
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

export function DropdownMenu({ trigger, items, align = "right", label }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

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
    <div ref={triggerRef} className="relative">
      {enhancedTrigger}
      <AnchoredPopover
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        align={align}
        id={menuId}
        role="menu"
        aria-label={label}
        className={["min-w-[12rem]", menuPanelClass].join(" ")}
      >
        <ul>
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
                {item.icon ? <span className="text-on-surface-variant">{item.icon}</span> : null}
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </AnchoredPopover>
    </div>
  );
}
