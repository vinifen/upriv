import { useCallback, useMemo, useState } from "react";
import wordmark from "@assets/Upriv-wordmark-white.svg";
import { Icon } from "@/components/icons";
import { Button, DropdownMenu, IconButton } from "@/components/ui";
import { useTranslation } from "@/i18n";

interface VaultListHeaderProps {
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onOpenSystemSettings?: () => void;
  onViewLogs?: () => void;
  onOpenHelp?: () => void;
}

export function VaultListHeader({
  onRefresh,
  isRefreshing = false,
  onOpenSystemSettings,
  onViewLogs,
  onOpenHelp,
}: VaultListHeaderProps) {
  const { t } = useTranslation();

  const overflowItems = useMemo(
    () => [
      {
        id: "system-settings",
        label: t("app.menu.system_settings"),
        icon: <Icon name="settings" size={18} />,
        onSelect: onOpenSystemSettings,
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
    ],
    [t, onOpenSystemSettings, onViewLogs, onOpenHelp],
  );

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-vault-list items-center justify-between px-margin-mobile py-4 md:px-margin-desktop">
        <img
          src={wordmark}
          alt={t("app.title")}
          className="h-5 w-auto object-contain md:h-6"
        />
        <div className="flex items-center gap-2">
          <IconButton
            label={t("action.refresh")}
            className="rounded-xl"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            <Icon
              name="refresh"
              size={20}
              className={isRefreshing ? "animate-spin" : undefined}
            />
          </IconButton>
          <Button
            variant="primary"
            size="md"
            className="gap-2 rounded-xl bg-primary font-mono text-sm font-medium text-on-primary shadow-lg shadow-primary/10 hover:bg-primary/95"
          >
            <Icon name="add" size={18} />
            {t("app.new_vault")}
          </Button>
          <DropdownMenu
            label={t("app.menu.more")}
            trigger={
              <IconButton label={t("app.menu.more")} className="rounded-xl">
                <Icon name="more-vertical" size={20} />
              </IconButton>
            }
            items={overflowItems}
          />
        </div>
      </div>
    </header>
  );
}

export function useRefreshState(durationMs = 800) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(() => {
    setIsRefreshing(true);
    window.setTimeout(() => setIsRefreshing(false), durationMs);
  }, [durationMs]);

  return { isRefreshing, refresh };
}
