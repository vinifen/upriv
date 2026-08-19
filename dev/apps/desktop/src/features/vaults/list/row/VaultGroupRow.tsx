import { Icon } from "@/components/icons";
import { IconButton } from "@/components/ui";
import { useTranslation } from "@/i18n";
import type { VaultGroup, VaultListViewMode } from "@upriv/shared";
import { VaultDragHandle } from "./VaultDragHandle";
import { vaultRowDensityClass } from "../lib/vaultListView";

interface VaultGroupRowProps {
  group: VaultGroup;
  groupedVaultCount: number;
  viewMode: VaultListViewMode;
  dragDisabled: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  /** When expanded with groupedVaults, soften bottom corners so the box reads as one unit. */
  expanded: boolean;
  onToggleCollapsed: (groupId: string) => void;
  onOpenSettings: (groupId: string) => void;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent) => void;
}

export function VaultGroupRow({
  group,
  groupedVaultCount,
  viewMode,
  dragDisabled,
  isDragging,
  isDragOver,
  expanded,
  onToggleCollapsed,
  onOpenSettings,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: VaultGroupRowProps) {
  const { t } = useTranslation();
  const density =
    viewMode === "blocks" ? vaultRowDensityClass.default : vaultRowDensityClass[viewMode];

  const toggleLabel = group.collapsed
    ? t("vault.group.toggle_expand")
    : t("vault.group.toggle_collapse");

  return (
    <article
      role="button"
      tabIndex={0}
      aria-expanded={!group.collapsed}
      aria-label={`${group.displayName}. ${toggleLabel}`}
      className={[
        "flex cursor-pointer items-center justify-between gap-3 bg-transparent px-3 sm:pl-2 sm:pr-4",
        expanded ? "rounded-t-xl" : "rounded-xl",
        density.article,
        isDragging ? "opacity-45" : "",
        isDragOver ? "ring-2 ring-accent/40 ring-offset-2 ring-offset-background" : "",
        "hover:bg-surface-row-hover/50",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => onToggleCollapsed(group.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggleCollapsed(group.id);
        }
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <VaultDragHandle
          disabled={dragDisabled}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
        <span
          className={[
            "inline-flex shrink-0 items-center justify-center text-on-surface-variant",
            density.icon,
          ].join(" ")}
          aria-hidden
        >
          <Icon
            name="chevron-down"
            size={density.iconSize}
            className={group.collapsed ? "-rotate-90 transition-transform" : "transition-transform"}
          />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className={["truncate font-semibold text-on-surface", density.title].join(" ")}>
            {group.displayName}
          </h3>
          <p className="text-xs text-on-surface-variant">
            {groupedVaultCount === 1
              ? t("vault.group.count_one")
              : t("vault.group.count", { count: String(groupedVaultCount) })}
          </p>
        </div>
      </div>
      <IconButton
        label={t("vault.group.open_settings")}
        size="sm"
        className="rounded-lg"
        onClick={(event) => {
          event.stopPropagation();
          onOpenSettings(group.id);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
        }}
      >
        <Icon name="settings" size={18} />
      </IconButton>
    </article>
  );
}
