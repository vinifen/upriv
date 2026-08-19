import { Icon } from "@/components/icons";
import { Button, DropdownPanel, MenuPanelGroup, MenuPanelOption } from "@/components/ui";
import { useTranslation } from "@/i18n";
import type {
  VaultListSort,
  VaultListSortDirection,
  VaultListSortMode,
  VaultListViewMode,
} from "@upriv/shared";
import { SORT_DIRECTION_ICON, SORT_MODE_ICON, VIEW_MODE_ICON } from "../lib/vaultListToolbarIcons";

const SORT_MODES: VaultListSortMode[] = ["order", "name", "state", "last_accessed", "groups"];
const SORT_DIRECTIONS: VaultListSortDirection[] = ["asc", "desc"];
const VIEW_MODES: VaultListViewMode[] = ["default", "large", "compact", "blocks"];

/** Same outer box as header ⋮ / Button `md` (`h-10`) — bordered secondary chrome. */
const toolbarButtonClass = "h-10 min-h-10 rounded-xl px-3";

interface VaultListSectionHeaderProps {
  sort: VaultListSort;
  onSortChange: (sort: VaultListSort) => void;
  viewMode: VaultListViewMode;
  onViewModeChange: (viewMode: VaultListViewMode) => void;
}

/** Section row: title left, sort/view filters right (shared layout with mobile). */
export function VaultListSectionHeader({
  sort,
  onSortChange,
  viewMode,
  onViewModeChange,
}: VaultListSectionHeaderProps) {
  const { t } = useTranslation();

  const sortModeLabel = t(`vault.list.sort.mode.${sort.mode}`);
  const sortDirectionLabel = t(`vault.list.sort.direction.${sort.direction}`);
  const viewLabel = t(`vault.list.view.mode.${viewMode}`);

  return (
    <div className="mb-6 flex h-10 items-center justify-between gap-3">
      <div className="flex h-10 min-w-0 items-center gap-2.5">
        <Icon
          name="encrypted"
          size={22}
          className="shrink-0 text-on-surface-variant"
          aria-hidden
        />
        <h1 className="min-w-0 font-display text-xl font-semibold leading-none tracking-tight text-on-surface sm:text-2xl">
          {t("vault.list.title")}
        </h1>
      </div>
      <div className="flex h-10 shrink-0 items-center gap-2">
        <DropdownPanel
          label={t("vault.list.sort.title")}
          align="right"
          minWidth="15rem"
          trigger={
            <Button
              type="button"
              variant="secondary"
              size="md"
              className={toolbarButtonClass}
              aria-label={`${t("vault.list.sort.title")}: ${sortModeLabel}, ${sortDirectionLabel}`}
              title={`${sortModeLabel} · ${sortDirectionLabel}`}
            >
              <span className="inline-flex items-center gap-1">
                <Icon name={SORT_MODE_ICON[sort.mode]} size={20} />
                <Icon
                  name={SORT_DIRECTION_ICON[sort.direction]}
                  size={14}
                  className="text-on-surface-variant"
                />
              </span>
            </Button>
          }
        >
          <MenuPanelGroup label={t("vault.list.sort.by_label")}>
            {SORT_MODES.map((mode) => (
              <MenuPanelOption
                key={mode}
                selected={sort.mode === mode}
                label={t(`vault.list.sort.mode.${mode}`)}
                icon={<Icon name={SORT_MODE_ICON[mode]} size={18} />}
                onSelect={() => onSortChange({ ...sort, mode })}
              />
            ))}
          </MenuPanelGroup>
          <MenuPanelGroup label={t("vault.list.sort.direction_label")}>
            {SORT_DIRECTIONS.map((direction) => (
              <MenuPanelOption
                key={direction}
                selected={sort.direction === direction}
                label={t(`vault.list.sort.direction.${direction}`)}
                icon={<Icon name={SORT_DIRECTION_ICON[direction]} size={18} />}
                onSelect={() => onSortChange({ ...sort, direction })}
              />
            ))}
          </MenuPanelGroup>
        </DropdownPanel>

        <DropdownPanel
          label={t("vault.list.view.title")}
          align="right"
          minWidth="13rem"
          trigger={
            <Button
              type="button"
              variant="secondary"
              size="md"
              className={toolbarButtonClass}
              aria-label={`${t("vault.list.view.title")}: ${viewLabel}`}
              title={viewLabel}
            >
              <Icon name={VIEW_MODE_ICON[viewMode]} size={20} />
            </Button>
          }
        >
          <MenuPanelGroup label={t("vault.list.view.layout_label")}>
            {VIEW_MODES.map((mode) => (
              <MenuPanelOption
                key={mode}
                selected={viewMode === mode}
                label={t(`vault.list.view.mode.${mode}`)}
                icon={<Icon name={VIEW_MODE_ICON[mode]} size={18} />}
                onSelect={() => onViewModeChange(mode)}
              />
            ))}
          </MenuPanelGroup>
        </DropdownPanel>
      </div>
    </div>
  );
}
