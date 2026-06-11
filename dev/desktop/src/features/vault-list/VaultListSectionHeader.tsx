import { Icon } from "@/components/icons";
import { Button, DropdownPanel, MenuPanelGroup, MenuPanelOption } from "@/components/ui";
import { useTranslation } from "@/i18n";
import type { VaultListSort, VaultListSortDirection, VaultListSortMode } from "./vaultListSort";
import type { VaultListViewMode } from "./vaultListView";
import { SORT_DIRECTION_ICON, SORT_MODE_ICON, VIEW_MODE_ICON } from "./vaultListToolbarIcons";

const SORT_MODES: VaultListSortMode[] = ["order", "name", "state", "last_accessed"];
const SORT_DIRECTIONS: VaultListSortDirection[] = ["asc", "desc"];
const VIEW_MODES: VaultListViewMode[] = ["default", "large", "compact", "blocks"];

const toolbarButtonClass = "rounded-xl px-3";

interface VaultListSectionHeaderProps {
  sort: VaultListSort;
  onSortChange: (sort: VaultListSort) => void;
  viewMode: VaultListViewMode;
  onViewModeChange: (viewMode: VaultListViewMode) => void;
}

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
    <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="text-center sm:text-left">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-on-surface md:text-3xl">
          {t("vault.list.title")}
        </h1>
        <p className="mt-1 text-sm text-on-surface-variant">{t("vault.list.subtitle")}</p>
      </div>
      <div className="flex shrink-0 items-center justify-center gap-2 sm:justify-end">
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
