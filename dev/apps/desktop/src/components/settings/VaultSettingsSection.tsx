import { useId, useState, type ReactNode } from "react";
import { GROUP_COLLAPSE_MS, GROUP_EXPAND_MS } from "@upriv/shared";
import { Icon } from "@/components/icons";
import { Collapse } from "@/components/ui/Collapse";

interface VaultSettingsSectionProps {
  title: string;
  defaultOpen?: boolean;
  /** When set, expansion is controlled by the parent (e.g. help search). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  tone?: "default" | "danger";
  /** End of the header, outside the expand button, so its controls never toggle the section. */
  aside?: ReactNode;
  children: ReactNode;
}

export function VaultSettingsSection({
  title,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  tone = "default",
  aside,
  children,
}: VaultSettingsSectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const panelId = useId();
  const triggerId = useId();

  const toggle = () => {
    const next = !open;
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  return (
    <section
      className={[
        "settings-section rounded-xl bg-surface-container transition-colors",
        open ? "" : "hover:bg-surface-container-high/80",
      ].join(" ")}
    >
      <div className="flex items-center">
        <button
          id={triggerId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-3 text-left sm:gap-3 sm:px-4 sm:py-4"
        >
          <Icon
            name="chevron-down"
            size={18}
            className={[
              "shrink-0 text-on-surface-variant transition-transform motion-reduce:!transition-none",
              open ? "rotate-0" : "-rotate-90",
            ].join(" ")}
            style={{
              transitionDuration: `${open ? GROUP_EXPAND_MS : GROUP_COLLAPSE_MS}ms`,
            }}
          />
          <span
            className={[
              "font-mono text-xs font-medium uppercase tracking-wide",
              tone === "danger" ? "text-on-error-container" : "text-on-surface",
            ].join(" ")}
          >
            {title}
          </span>
        </button>
        {aside ? (
          <div className="flex shrink-0 items-center gap-2 pr-3 sm:pr-4">{aside}</div>
        ) : null}
      </div>
      <Collapse open={open}>
        <div
          id={panelId}
          role="region"
          aria-labelledby={triggerId}
          className="px-3 pb-3 pt-0 sm:px-4 sm:pb-4"
        >
          {children}
        </div>
      </Collapse>
    </section>
  );
}
