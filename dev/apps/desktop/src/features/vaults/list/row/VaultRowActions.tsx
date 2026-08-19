import { useMemo } from "react";
import { Icon } from "@/components/icons";
import { DropdownMenu, IconButton } from "@/components/ui";
import { vaultBlocksBulkExport } from "@/features/system/settings";
import { useTranslation } from "@/i18n";
import { resolveVaultDisplayStatus, storageModeHasPortableArchive, type VaultListItem } from "@upriv/shared";

const rowActionProps = {
  size: "row" as const,
  variant: "row-action" as const,
};

interface VaultRowActionsProps {
  vault: VaultListItem;
  disabled?: boolean;
  onOpenBackups: (vaultId: string) => void;
  onOpenNote: (vaultId: string) => void;
  onOpenSettings: (vaultId: string) => void;
  onOpenGroupAssignment: (vaultId: string) => void;
  onExportVault: (vault: VaultListItem) => void;
  onOpenFolder: (vault: VaultListItem) => void;
  onOpenFileManager: (vault: VaultListItem) => void;
}

export function VaultRowActions({
  vault,
  disabled = false,
  onOpenBackups,
  onOpenNote,
  onOpenSettings,
  onOpenGroupAssignment,
  onExportVault,
  onOpenFolder,
  onOpenFileManager,
}: VaultRowActionsProps) {
  const { t } = useTranslation();
  const isOpen = resolveVaultDisplayStatus(vault) === "open";
  const canExport = !vaultBlocksBulkExport(vault);
  const hasPortableArchive = storageModeHasPortableArchive(vault.storageMode);

  const moreItems = useMemo(
    () => [
      ...(isOpen
        ? [
            {
              id: "open_upriv",
              label: t("action.open_upriv"),
              icon: <Icon name="file-manager" size={18} />,
              onSelect: () => {
                window.requestAnimationFrame(() => onOpenFileManager(vault));
              },
            },
            {
              id: "open_folder",
              label: t("action.open_folder"),
              icon: <Icon name="folder" size={18} />,
              onSelect: () => {
                window.requestAnimationFrame(() => onOpenFolder(vault));
              },
            },
          ]
        : canExport
          ? [
              {
                id: "export",
                label: t("action.export_vault"),
                icon: <Icon name="download" size={18} />,
                onSelect: () => {
                  window.requestAnimationFrame(() => onExportVault(vault));
                },
              },
            ]
          : []),
      ...(hasPortableArchive
        ? [
            {
              id: "backups",
              label: t("action.backups"),
              icon: <Icon name="archive" size={18} />,
              onSelect: () => {
                window.requestAnimationFrame(() => onOpenBackups(vault.id));
              },
            },
          ]
        : []),
      {
        id: "note",
        label: t("action.note"),
        icon: <Icon name="note" size={18} />,
        onSelect: () => {
          window.requestAnimationFrame(() => onOpenNote(vault.id));
        },
      },
      {
        id: "group",
        label: t("vault.group.assignment.menu"),
        icon: <Icon name="folder" size={18} />,
        onSelect: () => {
          window.requestAnimationFrame(() => onOpenGroupAssignment(vault.id));
        },
      },
    ],
    [
      canExport,
      hasPortableArchive,
      isOpen,
      onExportVault,
      onOpenBackups,
      onOpenFileManager,
      onOpenFolder,
      onOpenGroupAssignment,
      onOpenNote,
      t,
      vault,
    ],
  );

  return (
    <div
      className={[
        "flex items-center gap-1 text-on-surface-variant",
        disabled ? "pointer-events-none opacity-50" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-disabled={disabled || undefined}
    >
      <IconButton
        label={t("action.settings")}
        {...rowActionProps}
        disabled={disabled}
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
          <IconButton label={t("app.menu.more")} {...rowActionProps} disabled={disabled}>
            <Icon name="more-horizontal" size={20} />
          </IconButton>
        }
        items={moreItems}
      />
    </div>
  );
}
