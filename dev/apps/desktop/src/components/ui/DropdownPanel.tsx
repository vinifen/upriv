import {
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { menuGroupLabelClass, menuPanelClass, menuPanelOptionClass } from "./menuStyles";

type DropdownTriggerProps = {
  className?: string;
  onClick?: (event: React.MouseEvent) => void;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: "menu" | boolean;
  "aria-controls"?: string;
};

interface DropdownPanelProps {
  trigger: ReactElement<DropdownTriggerProps>;
  label: string;
  align?: "left" | "right";
  minWidth?: string;
  children: ReactNode;
}

const PanelCloseContext = createContext<(() => void) | null>(null);

/** Closes the parent dropdown panel after selection (same pattern as ⋮ menus). */
export function useDropdownPanelClose(): () => void {
  const close = useContext(PanelCloseContext);
  return close ?? (() => undefined);
}

const triggerActiveClass = "bg-surface-container-highest text-on-surface";

export function DropdownPanel({
  trigger,
  label,
  align = "right",
  minWidth = "14rem",
  children,
}: DropdownPanelProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);

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
        "aria-controls": panelId,
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
      {open ? (
        <div
          id={panelId}
          role="menu"
          aria-label={label}
          style={{ minWidth }}
          className={[
            "absolute z-50 mt-2 py-1",
            menuPanelClass,
            align === "right" ? "right-0" : "left-0",
          ].join(" ")}
        >
          <PanelCloseContext.Provider value={close}>{children}</PanelCloseContext.Provider>
        </div>
      ) : null}
    </div>
  );
}

interface MenuPanelGroupProps {
  label: string;
  children: ReactNode;
}

export function MenuPanelGroup({ label, children }: MenuPanelGroupProps) {
  return (
    <div role="group" aria-label={label} className="py-1">
      <p className={menuGroupLabelClass}>{label}</p>
      <ul role="none">{children}</ul>
    </div>
  );
}

interface MenuPanelOptionProps {
  selected?: boolean;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
}

export function MenuPanelOption({ selected = false, label, icon, onSelect }: MenuPanelOptionProps) {
  const close = useDropdownPanelClose();

  return (
    <li role="none">
      <button
        type="button"
        role="menuitemradio"
        aria-checked={selected}
        className={[
          menuPanelOptionClass,
          selected ? "bg-accent/15 font-medium text-on-surface" : "",
        ].join(" ")}
        onClick={() => {
          onSelect();
          close();
        }}
      >
        {icon ? (
          <span className="flex w-5 shrink-0 items-center justify-center text-on-surface-variant">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1">{label}</span>
        <span
          aria-hidden
          className={[
            "w-4 shrink-0 font-mono text-xs",
            selected ? "text-vault-open" : "text-transparent",
          ].join(" ")}
        >
          ✓
        </span>
      </button>
    </li>
  );
}
