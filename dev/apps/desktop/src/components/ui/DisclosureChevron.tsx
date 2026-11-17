import { GROUP_COLLAPSE_MS, GROUP_EXPAND_MS } from "@upriv/shared";
import { Icon } from "@/components/icons";

/**
 * The chevron of a section that opens in place: down while open, turned to
 * point right while closed, at the speed of the section's own `Collapse`.
 */
export function DisclosureChevron({
  open,
  size = 18,
  className = "",
}: {
  open: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <Icon
      name="chevron-down"
      size={size}
      className={[
        "shrink-0 transition-transform motion-reduce:!transition-none",
        open ? "rotate-0" : "-rotate-90",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ transitionDuration: `${open ? GROUP_EXPAND_MS : GROUP_COLLAPSE_MS}ms` }}
    />
  );
}
