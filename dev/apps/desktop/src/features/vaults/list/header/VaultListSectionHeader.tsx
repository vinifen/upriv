import { Icon } from "@/components/icons";
import { Button, DropdownPanel, MenuPanelGroup, MenuPanelOption } from "@/components/ui";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation } from "@/i18n";
import {
  SORT_DIRECTION_ICON,
  SORT_MODE_ICON,
  VIEW_MODE_ICON,
  type VaultListSort,
  type VaultListSortDirection,
  type VaultListSortMode,
  type VaultListViewMode,
} from "@upriv/shared";
import { VaultListSearch } from "./VaultListSearch";

const SORT_MODES: VaultListSortMode[] = ["order", "name", "state", "last_accessed", "groups"];
const SORT_DIRECTIONS: VaultListSortDirection[] = ["asc", "desc"];
const VIEW_MODES: VaultListViewMode[] = ["default", "large", "compact", "blocks"];

const toolbarIconButtonClass =
  "h-[var(--control-height-md)] w-[var(--control-height-md)] min-h-[var(--control-height-md)] min-w-[var(--control-height-md)] shrink-0 rounded-xl !px-0";
/** Same footprint as header ⋮ / gear (`--control-width-chrome`). */
const toolbarChromeButtonClass =
  "h-[var(--control-height-md)] w-[var(--control-width-chrome)] min-h-[var(--control-height-md)] min-w-[var(--control-width-chrome)] shrink-0 rounded-xl !px-0";

interface VaultListSectionHeaderProps {
  sort: VaultListSort;
  onSortChange: (sort: VaultListSort) => void;
  viewMode: VaultListViewMode;
  onViewModeChange: (viewMode: VaultListViewMode) => void;
  search: string;
  onSearchChange: (query: string) => void;
  onNewVault: () => void;
}

/** Section row: title + optional create, then search / sort / display. */
export function VaultListSectionHeader({
  sort,
  onSortChange,
  viewMode,
  onViewModeChange,
  search,
  onSearchChange,
  onNewVault,
}: VaultListSectionHeaderProps) {
  const { t } = useTranslation();
  const { settings } = useAppSettingsContext();
  const showCreate = settings.ui.vault_list_show_create_button !== false;
  const showSearch = settings.ui.vault_list_show_search_button !== false;
  const showSort = settings.ui.vault_list_show_sort_button !== false;
  const showView = settings.ui.vault_list_show_view_button !== false;

  const sortModeLabel = t(`vault.list.sort.mode.${sort.mode}`);
  const sortDirectionLabel = t(`vault.list.sort.direction.${sort.direction}`);
  const viewLabel = t(`vault.list.view.mode.${viewMode}`);

  return (
    <div className="mb-6 flex h-10 min-w-0 items-center gap-3 overflow-hidden">
      <div className="flex h-10 min-w-0 shrink items-center gap-2.5">
        <Icon name="encrypted" size={22} className="shrink-0 text-on-surface-variant" aria-hidden />
        <h1 className="min-w-0 shrink truncate font-display text-xl font-semibold leading-none tracking-tight text-on-surface sm:text-2xl">
          {t("vault.list.title")}
        </h1>
        {showCreate ? (
          <Button
            type="button"
            variant="secondary"
            size="md"
            className={toolbarIconButtonClass}
            aria-label={t("app.new_vault")}
            title={t("app.new_vault")}
            onClick={onNewVault}
          >
            <Icon name="add" size={20} />
          </Button>
        ) : null}
      </div>
      {showSearch || showSort || showView ? (
        <div className="flex h-10 min-w-0 flex-1 items-center justify-end gap-2">
          {showSearch ? <VaultListSearch value={search} onChange={onSearchChange} /> : null}

          {showSort ? (
            <DropdownPanel
              label={t("vault.list.sort.title")}
              align="right"
              minWidth="15rem"
              trigger={
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  className={toolbarChromeButtonClass}
                  aria-label={`${t("vault.list.sort.title")}: ${sortModeLabel}, ${sortDirectionLabel}`}
                  title={`${sortModeLabel} · ${sortDirectionLabel}`}
                >
                  <span className="inline-flex items-center">
                    <Icon name={SORT_MODE_ICON[sort.mode]} size={18} />
                    <Icon
                      name={SORT_DIRECTION_ICON[sort.direction]}
                      size={12}
                      className="-ml-1.5 text-on-surface-variant"
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
          ) : null}

          {showView ? (
            <DropdownPanel
              label={t("vault.list.view.title")}
              align="right"
              minWidth="13rem"
              trigger={
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  className={toolbarChromeButtonClass}
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
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
