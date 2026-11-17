import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import { ABOVE_MODAL_Z_INDEX, AnchoredPopover } from "./AnchoredPopover";
import { MenuPanelHeader } from "./MenuPanelHeader";
import { menuItemClass, menuPanelClass } from "./menuStyles";

export interface DropdownMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** A second line under the label: why a disabled item waits, for one. */
  description?: string;
  /** Deletes or removes something: the error color. */
  danger?: boolean;
  /** An item that turns something on and off: a check while it is on. */
  checked?: boolean;
  className?: string;
  disabled?: boolean;
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
  /** Each time the menu opens, so items that depend on the moment can ask again. */
  onOpen?: () => void;
  /** The trigger sits inside a modal: the menu opens above it. */
  aboveModal?: boolean;
}

/** One step above row hover (`surface-container-high`) so the trigger stays visible. */
const triggerActiveClass = "bg-surface-container-highest text-on-surface";

export function DropdownMenu({
  trigger,
  items,
  align = "right",
  label,
  onOpen,
  aboveModal = false,
}: DropdownMenuProps) {
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
          if (!open) onOpen?.();
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
        zIndex={aboveModal ? ABOVE_MODAL_Z_INDEX : undefined}
        className={["min-w-[12rem] py-1", menuPanelClass].join(" ")}
      >
        <MenuPanelHeader title={label} onClose={() => setOpen(false)} />
        <ul>
          {items.map((item) => (
            <li key={item.id} role="none">
              <button
                type="button"
                role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                aria-checked={item.checked}
                disabled={item.disabled}
                className={[
                  menuItemClass,
                  item.danger ? "!text-on-error-container" : "",
                  item.className,
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => {
                  if (item.disabled) return;
                  item.onSelect?.();
                  setOpen(false);
                }}
              >
                {item.icon ? (
                  <span
                    className={item.danger ? "text-on-error-container" : "text-on-surface-variant"}
                  >
                    {item.icon}
                  </span>
                ) : null}
                {item.description ? (
                  <span className="min-w-0 flex-1">
                    <span className="block">{item.label}</span>
                    <span className="mt-0.5 block whitespace-normal font-sans text-xs leading-snug text-on-surface-variant">
                      {item.description}
                    </span>
                  </span>
                ) : (
                  item.label
                )}
                {item.checked ? (
                  <span aria-hidden className="ml-auto pl-3 text-xs text-vault-open">
                    ✓
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </AnchoredPopover>
    </div>
  );
}
