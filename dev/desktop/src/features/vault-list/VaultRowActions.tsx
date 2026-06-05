import { useMemo } from "react";
import { Icon } from "@/components/icons";
import { DropdownMenu, IconButton } from "@/components/ui";
import { useTranslation } from "@/i18n";
import type { VaultListItem } from "./types";

const rowActionProps = {
  size: "row" as const,
  variant: "row-action" as const,
};

interface VaultRowActionsProps {
  vault: VaultListItem;
  onOpenBackups: (vaultId: string) => void;
  onOpenNote: (vaultId: string) => void;
  onOpenSettings: (vaultId: string) => void;
}

export function VaultRowActions({
  vault,
  onOpenBackups,
  onOpenNote,
  onOpenSettings,
}: VaultRowActionsProps) {
  const { t } = useTranslation();

  const moreItems = useMemo(
    () => [
      {
        id: "backups",
        label: t("action.backups"),
        icon: <Icon name="archive" size={18} />,
        onSelect: () => {
          window.requestAnimationFrame(() => onOpenBackups(vault.id));
        },
      },
      {
        id: "note",
        label: t("action.note"),
        icon: <Icon name="note" size={18} />,
        onSelect: () => {
          window.requestAnimationFrame(() => onOpenNote(vault.id));
        },
      },
    ],
    [t, vault.id, onOpenBackups, onOpenNote],
  );

  return (
    <div className="flex items-center gap-1 text-on-surface-variant">
      <IconButton
        label={t("action.settings")}
        {...rowActionProps}
        onClick={() => {
          window.requestAnimationFrame(() => onOpenSettings(vault.id));
        }}
      >
        <Icon name="settings" size={20} />
      </IconButton>
      <DropdownMenu
        label={t("app.menu.more")}
        align="right"
        trigger={
          <IconButton label={t("app.menu.more")} {...rowActionProps}>
            <Icon name="more-horizontal" size={20} />
          </IconButton>
        }
        items={moreItems}
      />
    </div>
  );
}
