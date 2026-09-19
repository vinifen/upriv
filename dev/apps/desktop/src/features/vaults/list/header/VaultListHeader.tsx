import { useMemo } from "react";
import { UprivWordmark } from "@/components/brand/UprivWordmark";
import { Icon } from "@/components/icons";
import { DropdownMenu, IconButton } from "@/components/ui";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation } from "@/i18n";

interface VaultListHeaderProps {
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onOpenSystemSettings?: () => void;
  onOpenDataFolder?: () => void;
  onViewLogs?: () => void;
  onOpenHelp?: () => void;
  onOpenSystemInfo?: () => void;
  onOpenGroups?: () => void;
}

export function VaultListHeader({
  onRefresh,
  isRefreshing = false,
  onOpenSystemSettings,
  onOpenDataFolder,
  onViewLogs,
  onOpenHelp,
  onOpenSystemInfo,
  onOpenGroups,
}: VaultListHeaderProps) {
  const { t } = useTranslation();
  const { settings } = useAppSettingsContext();
  const showHeaderMore = settings.ui.vault_list_show_header_more_button !== false;

  const headerChromeBtn =
    "w-[var(--control-width-chrome)] min-w-[var(--control-width-chrome)] border border-outline-variant bg-transparent hover:bg-surface-container-high";

  const settingsItems = useMemo(
    () => [
      {
        id: "system-settings",
        label: t("app.menu.system_settings"),
        icon: <Icon name="settings" size={18} />,
        onSelect: onOpenSystemSettings,
      },
      {
        id: "groups",
        label: t("app.menu.groups"),
        icon: <Icon name="layers" size={18} />,
        onSelect: onOpenGroups,
      },
      {
        id: "data-folder",
        label: t("app.menu.data_folder"),
        icon: <Icon name="folder" size={18} />,
        onSelect: onOpenDataFolder,
      },
    ],
    [t, onOpenSystemSettings, onOpenGroups, onOpenDataFolder],
  );

  const overflowItems = useMemo(
    () => [
      {
        id: "refresh",
        label: t("action.refresh"),
        icon: (
          <Icon name="refresh" size={18} className={isRefreshing ? "animate-spin" : undefined} />
        ),
        disabled: isRefreshing,
        onSelect: onRefresh,
      },
      {
        id: "view-logs",
        label: t("app.menu.view_logs"),
        icon: <Icon name="terminal" size={18} />,
        onSelect: onViewLogs,
      },
      {
        id: "help",
        label: t("app.menu.help"),
        icon: <Icon name="help" size={18} />,
        onSelect: onOpenHelp,
      },
      {
        id: "system-info",
        label: t("app.menu.system_info"),
        icon: <Icon name="info" size={18} />,
        onSelect: onOpenSystemInfo,
      },
    ],
    [t, onRefresh, isRefreshing, onViewLogs, onOpenHelp, onOpenSystemInfo],
  );

  return (
    <header className="sticky top-0 z-40 bg-background">
      <div className="mx-auto flex max-w-vault-list items-center justify-between px-margin-mobile py-4 md:px-margin-desktop">
        <UprivWordmark theme={settings.ui.theme} className="h-6 w-auto object-contain" />
        <div className="flex items-center gap-2">
          {showHeaderMore ? (
            <DropdownMenu
              label={t("app.menu.more")}
              trigger={
                <IconButton label={t("app.menu.more")} size="md" className={headerChromeBtn}>
                  <Icon name="more-vertical" size={20} />
                </IconButton>
              }
              items={overflowItems}
            />
          ) : null}
          <DropdownMenu
            label={t("action.settings")}
            trigger={
              <IconButton label={t("action.settings")} size="md" className={headerChromeBtn}>
                <Icon name="settings" size={18} />
              </IconButton>
            }
            items={settingsItems}
          />
        </div>
      </div>
    </header>
  );
}
