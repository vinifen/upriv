import { Icon } from "@/components/icons";
import { IconButton } from "@/components/ui";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation } from "@/i18n";
import type { VaultGroup, VaultListViewMode } from "@upriv/shared";
import { VaultDragHandle } from "./VaultDragHandle";
import { VaultHiddenIndicator } from "./VaultHiddenIndicator";
import { vaultRowDensityClass } from "../lib/vaultListView";
import type { VaultListPointerDragHandlers } from "./vaultListPointerDrag";

interface VaultGroupRowProps {
  group: VaultGroup;
  groupedVaultCount: number;
  viewMode: VaultListViewMode;
  dragDisabled: boolean;
  isDragging: boolean;
  /** When expanded with groupedVaults, soften bottom corners so the box reads as one unit. */
  expanded: boolean;
  dropKey: string;
  pointerDrag: VaultListPointerDragHandlers;
  onToggleCollapsed: (groupId: string) => void;
  onOpenSettings: (groupId: string) => void;
}

export function VaultGroupRow({
  group,
  groupedVaultCount,
  viewMode,
  dragDisabled,
  isDragging,
  expanded,
  dropKey,
  pointerDrag,
  onToggleCollapsed,
  onOpenSettings,
}: VaultGroupRowProps) {
  const { t } = useTranslation();
  const { settings } = useAppSettingsContext();
  const showGroupSettings = settings.ui.vault_list_show_group_settings_button !== false;
  const density =
    viewMode === "blocks" ? vaultRowDensityClass.default : vaultRowDensityClass[viewMode];

  const toggleLabel = group.collapsed
    ? t("vault.group.toggle_expand")
    : t("vault.group.toggle_collapse");

  return (
    <article
      className={[
        "flex items-center justify-between gap-3 bg-transparent px-3 sm:pr-4",
        dragDisabled ? "sm:pl-4" : "sm:pl-2",
        expanded ? "rounded-t-xl" : "rounded-xl",
        density.article,
        isDragging ? "opacity-45" : "",
        "hover:bg-surface-row-hover/50",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        {!dragDisabled ? (
          <VaultDragHandle
            disabled={dragDisabled}
            dropKey={dropKey}
            onPointerDragStart={pointerDrag.onStart}
            onPointerDragMove={pointerDrag.onMove}
            onPointerDragEnd={pointerDrag.onEnd}
            onPointerDragCancel={pointerDrag.onCancel}
          />
        ) : null}
        <div
          role="button"
          tabIndex={0}
          aria-expanded={!group.collapsed}
          aria-label={`${group.displayName}. ${toggleLabel}`}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 sm:gap-3"
          onClick={() => onToggleCollapsed(group.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onToggleCollapsed(group.id);
            }
          }}
        >
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
              className={
                group.collapsed ? "-rotate-90 transition-transform" : "transition-transform"
              }
            />
          </span>
          <div className="min-w-0 flex-1">
            <h3
              className={[
                "flex min-w-0 items-center gap-2 font-semibold text-on-surface",
                density.title,
              ].join(" ")}
            >
              <span className="truncate">{group.displayName}</span>
              <VaultHiddenIndicator hidden={group.hidden} labelKey="vault.group.hidden.badge" />
            </h3>
            <p className="text-xs text-on-surface-variant">
              {groupedVaultCount === 1
                ? t("vault.group.count_one")
                : t("vault.group.count", { count: String(groupedVaultCount) })}
            </p>
          </div>
        </div>
      </div>
      {showGroupSettings ? (
        <IconButton
          label={t("vault.group.open_settings")}
          size="sm"
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
      ) : null}
    </article>
  );
}
