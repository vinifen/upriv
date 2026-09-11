import { useMemo } from "react";
import { Icon } from "@/components/icons";
import { DropdownMenu, IconButton } from "@/components/ui";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation } from "@/i18n";
import {
  resolveVaultDisplayStatus,
  vaultCanExport,
  VAULT_SETTINGS_AREA_ICON,
  VAULT_SETTINGS_AREA_I18N,
  VAULT_SETTINGS_AREAS,
  type VaultListItem,
  type VaultSettingsAreaId,
} from "@upriv/shared";

const rowActionProps = {
  size: "row" as const,
  variant: "row-action" as const,
};

interface VaultRowActionsProps {
  vault: VaultListItem;
  pipelineListStatus?: {
    openingVaultIds?: readonly string[];
    closingVaultIds?: readonly string[];
  };
  disabled?: boolean;
  onOpenBackups: (vaultId: string) => void;
  onOpenNote: (vaultId: string) => void;
  onOpenVaultInfo: (vaultId: string) => void;
  onOpenSettings: (vaultId: string, area: VaultSettingsAreaId) => void;
  onExportVault: (vault: VaultListItem) => void;
  onOpenFolder: (vault: VaultListItem) => void;
  onOpenFileManager: (vault: VaultListItem) => void;
  /** Block cards: stack ⋯ / settings to the right of the title. */
  layout?: "row" | "column";
  /** When Unlock/Lock is off the row (compact chrome), keep it first in ⋯. */
  includeLockAction?: boolean;
  onLockVault?: (vault: VaultListItem) => void;
  onUnlockVault?: (vault: VaultListItem) => void;
}

export function VaultRowActions({
  vault,
  pipelineListStatus,
  disabled = false,
  onOpenBackups,
  onOpenNote,
  onOpenVaultInfo,
  onOpenSettings,
  onExportVault,
  onOpenFolder,
  onOpenFileManager,
  layout = "row",
  includeLockAction = false,
  onLockVault,
  onUnlockVault,
}: VaultRowActionsProps) {
  const { t } = useTranslation();
  const { settings } = useAppSettingsContext();
  const showVaultMore = settings.ui.vault_list_show_vault_more_button !== false;
  const showVaultSettings = settings.ui.vault_list_show_vault_settings_button !== false;
  const isOpen = resolveVaultDisplayStatus(vault) === "open";
  const canExport = vaultCanExport(vault, pipelineListStatus);

  const stacked = layout === "column";
  const actionBtnProps = stacked
    ? { size: "sm" as const, variant: "row-action" as const }
    : rowActionProps;
  const actionIconSize = stacked ? 18 : 20;

  const settingsItems = useMemo(
    () =>
      VAULT_SETTINGS_AREAS.map((area) => ({
        id: area,
        label: t(VAULT_SETTINGS_AREA_I18N[area]),
        icon: <Icon name={VAULT_SETTINGS_AREA_ICON[area]} size={18} />,
        onSelect: () => {
          window.requestAnimationFrame(() => onOpenSettings(vault.id, area));
        },
      })),
    [onOpenSettings, t, vault.id],
  );

  const moreItems = useMemo(
    () => [
      ...(includeLockAction
        ? [
            {
              id: isOpen ? "lock" : "unlock",
              label: isOpen ? t("action.lock") : t("action.unlock"),
              icon: <Icon name={isOpen ? "lock" : "lock-open"} size={18} />,
              onSelect: () => {
                window.requestAnimationFrame(() => {
                  if (isOpen) onLockVault?.(vault);
                  else onUnlockVault?.(vault);
                });
              },
            },
          ]
        : []),
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
        : []),
      ...(canExport
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
      {
        id: "vault-info",
        label: t("action.vault_info"),
        icon: <Icon name="info" size={18} />,
        onSelect: () => {
          window.requestAnimationFrame(() => onOpenVaultInfo(vault.id));
        },
      },
    ],
    [
      canExport,
      includeLockAction,
      isOpen,
      onExportVault,
      onLockVault,
      onOpenBackups,
      onOpenFileManager,
      onOpenFolder,
      onOpenNote,
      onOpenVaultInfo,
      onUnlockVault,
      t,
      vault,
    ],
  );

  if (!showVaultMore && !showVaultSettings) return null;

  return (
    <div
      className={[
        stacked
          ? "flex h-full flex-col items-center justify-between text-on-surface-variant"
          : "flex items-center gap-1 text-on-surface-variant",
        disabled ? "pointer-events-none opacity-50" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-disabled={disabled || undefined}
    >
      {showVaultMore ? (
        <DropdownMenu
          label={t("app.menu.more")}
          align="right"
          trigger={
            <IconButton label={t("app.menu.more")} {...actionBtnProps} disabled={disabled}>
              <Icon name="more-horizontal" size={actionIconSize} />
            </IconButton>
          }
          items={moreItems}
        />
      ) : null}
      {showVaultSettings ? (
        <DropdownMenu
          label={t("action.settings")}
          align="right"
          trigger={
            <IconButton label={t("action.settings")} {...actionBtnProps} disabled={disabled}>
              <Icon name="settings" size={actionIconSize} />
            </IconButton>
          }
          items={settingsItems}
        />
      ) : null}
    </div>
  );
}
