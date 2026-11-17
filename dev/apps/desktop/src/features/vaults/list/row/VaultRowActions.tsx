import { useCallback, useMemo } from "react";
import { useOsFolderReady, useToast } from "@upriv/shared/react";
import { Icon } from "@/components/icons";
import { DropdownMenu, IconButton, Toast } from "@/components/ui";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation } from "@/i18n";
import { isElectronRenderer } from "@/lib/invoke";
import { revealFailureKey } from "@/lib/revealInOs";
import { rpcRevealOsPath } from "@/lib/rpc";
import { useVaultFileSystemService, useVaultService } from "@/platform/services";
import {
  isVaultListRowUnlockTarget,
  resolveVaultListStatus,
  vaultCloseNowOffered,
  vaultDeleteNowOffered,
  vaultExportMenuShown,
  VAULT_SETTINGS_MENU_ICON,
  VAULT_SETTINGS_MENU_I18N,
  vaultRowControls,
  vaultSettingsMenuEntries,
  type VaultListItem,
  type OsFolderAnswer,
  type VaultSettingsAreaId,
} from "@upriv/shared";

const rowActionProps = {
  size: "row" as const,
  variant: "row-action" as const,
};

interface VaultRowActionsProps {
  vault: VaultListItem;
  pipelineListStatus?: import("@upriv/shared").VaultPipelineListStatus;
  onOpenBackups: (vaultId: string) => void;
  onOpenNote: (vaultId: string) => void;
  onOpenVaultInfo: (vaultId: string) => void;
  onOpenSettings: (vaultId: string, area: VaultSettingsAreaId) => void;
  /** The Delete vault window, the last entry of the Settings menu. */
  onOpenDelete: (vaultId: string) => void;
  onExportVault: (vault: VaultListItem) => void;
  onOpenFileManager: (vault: VaultListItem) => void;
  /** Block cards: stack ⋯ / settings to the right of the title. */
  layout?: "row" | "column";
  /** When Unlock/Lock is off the row (compact chrome), keep it first in ⋯. */
  includeLockAction?: boolean;
  onLockVault?: (vault: VaultListItem) => void;
  onUnlockVault?: (vault: VaultListItem) => void;
  onCloseNow: (vault: VaultListItem) => void;
  /** Continue (`now` false) or Delete now (`now` true) for a vault being deleted. */
  onDeleteWork: (vault: VaultListItem, now: boolean) => void;
}

export function VaultRowActions({
  vault,
  pipelineListStatus,
  onOpenBackups,
  onOpenNote,
  onOpenVaultInfo,
  onOpenSettings,
  onOpenDelete,
  onExportVault,
  onOpenFileManager,
  layout = "row",
  includeLockAction = false,
  onLockVault,
  onUnlockVault,
  onCloseNow,
  onDeleteWork,
}: VaultRowActionsProps) {
  const { t } = useTranslation();
  const { toast, show, dismiss } = useToast();
  const { settings } = useAppSettingsContext();
  const vaultService = useVaultService();
  const fileSystem = useVaultFileSystemService();
  const showVaultMore = settings.ui.vault_list_show_vault_more_button !== false;
  const showVaultSettings = settings.ui.vault_list_show_vault_settings_button !== false;
  const listStatus = resolveVaultListStatus(vault, pipelineListStatus);
  const isOpen = listStatus === "open";
  const canUnlock = isVaultListRowUnlockTarget(listStatus);
  const canUseOpenWorkspace = listStatus === "open";
  // Open unlocked folder shows only while core says the vault's folder is in
  // the OS; asked again each time the menu opens.
  const osFolder = useOsFolderReady(
    (vaultId, path) => fileSystem.osPath(vaultId, path),
    vault.id,
    canUseOpenWorkspace && isElectronRenderer(),
  );
  const showOsFileManager = canUseOpenWorkspace && osFolder.ready;
  const canExport = vaultService.canExportVault && vaultExportMenuShown(vault, pipelineListStatus);
  const controls = vaultRowControls(vault, pipelineListStatus);
  const closeNowOffered = vaultCloseNowOffered(listStatus, vault.id, pipelineListStatus);
  const deleteNowOffered = vaultDeleteNowOffered(listStatus, vault.id, pipelineListStatus);

  const stacked = layout === "column";
  const actionBtnProps = stacked
    ? { size: "sm" as const, variant: "row-action" as const }
    : rowActionProps;
  const actionIconSize = stacked ? 18 : 20;

  /** Reveal the vault's folder in the OS. A folder gone meanwhile only hides the item. */
  const { recheck: recheckOsFolder } = osFolder;
  const openOsMount = useCallback(async () => {
    let answer: OsFolderAnswer;
    try {
      answer = await fileSystem.osPath(vault.id, "/");
    } catch {
      show(t("modal.file_manager.toast.open_system_failed"));
      return;
    }
    if (answer.state !== "ready") {
      recheckOsFolder();
      return;
    }
    const osPath = answer.osPath;
    const failure = await revealFailureKey(() => rpcRevealOsPath(osPath));
    if (failure) show(t(failure));
  }, [fileSystem, recheckOsFolder, show, t, vault.id]);

  const settingsItems = useMemo(
    () =>
      vaultSettingsMenuEntries(vault, pipelineListStatus).map((entry) => ({
        id: entry,
        label: t(VAULT_SETTINGS_MENU_I18N[entry]),
        icon: <Icon name={VAULT_SETTINGS_MENU_ICON[entry]} size={18} />,
        danger: entry === "delete",
        disabled: controls.settingsGearBlocked,
        onSelect: () => {
          if (controls.settingsGearBlocked) return;
          window.requestAnimationFrame(() => {
            if (entry === "delete") onOpenDelete(vault.id);
            else onOpenSettings(vault.id, entry);
          });
        },
      })),
    [controls.settingsGearBlocked, onOpenDelete, onOpenSettings, pipelineListStatus, t, vault],
  );

  const moreItems = useMemo(
    () => [
      ...(includeLockAction && (isOpen || canUnlock)
        ? [
            {
              id: isOpen ? "lock" : "unlock",
              label: isOpen ? t("action.lock") : t("action.unlock"),
              icon: <Icon name={isOpen ? "lock" : "lock-open"} size={18} />,
              disabled: controls.moreMenuBlocked,
              onSelect: () => {
                window.requestAnimationFrame(() => {
                  if (isOpen) onLockVault?.(vault);
                  else onUnlockVault?.(vault);
                });
              },
            },
          ]
        : []),
      ...(canUseOpenWorkspace
        ? [
            {
              id: "open_upriv",
              label: t("action.open_upriv"),
              icon: <Icon name="file-manager" size={18} />,
              disabled: controls.moreMenuBlocked,
              onSelect: () => {
                window.requestAnimationFrame(() => onOpenFileManager(vault));
              },
            },
            ...(showOsFileManager
              ? [
                  {
                    id: "open_os",
                    label: t("action.open_unlocked_folder"),
                    icon: <Icon name="folder" size={18} />,
                    disabled: controls.moreMenuBlocked,
                    onSelect: () => {
                      window.requestAnimationFrame(() => void openOsMount());
                    },
                  },
                ]
              : []),
          ]
        : []),
      ...(canExport
        ? [
            {
              id: "export",
              label: t("action.export_vault"),
              icon: <Icon name="download" size={18} />,
              disabled: controls.moreMenuBlocked,
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
        disabled: controls.moreMenuBlocked,
        onSelect: () => {
          window.requestAnimationFrame(() => onOpenBackups(vault.id));
        },
      },
      ...(controls.noteHidden
        ? []
        : [
            {
              id: "note",
              label: t("action.note"),
              icon: <Icon name="note" size={18} />,
              disabled: controls.noteBlocked,
              onSelect: () => {
                if (controls.noteBlocked) return;
                window.requestAnimationFrame(() => onOpenNote(vault.id));
              },
            },
          ]),
      ...(isOpen || closeNowOffered
        ? [
            {
              id: "close-now",
              label: t("action.close_now"),
              icon: <Icon name="lock" size={18} />,
              onSelect: () => {
                window.requestAnimationFrame(() => onCloseNow(vault));
              },
            },
          ]
        : []),
      ...(deleteNowOffered
        ? [
            {
              id: "delete-now",
              label: t("action.delete_now"),
              icon: <Icon name="trash" size={18} />,
              onSelect: () => {
                window.requestAnimationFrame(() => onDeleteWork(vault, true));
              },
            },
          ]
        : []),
      {
        id: "vault-info",
        label: t("action.vault_info"),
        icon: <Icon name="info" size={18} />,
        disabled: controls.moreMenuBlocked,
        onSelect: () => {
          window.requestAnimationFrame(() => onOpenVaultInfo(vault.id));
        },
      },
    ],
    [
      controls.moreMenuBlocked,
      canExport,
      canUnlock,
      canUseOpenWorkspace,
      closeNowOffered,
      deleteNowOffered,
      showOsFileManager,
      includeLockAction,
      isOpen,
      onCloseNow,
      onDeleteWork,
      onExportVault,
      onLockVault,
      onOpenBackups,
      onOpenFileManager,
      controls.noteBlocked,
      controls.noteHidden,
      onOpenNote,
      openOsMount,
      onOpenVaultInfo,
      onUnlockVault,
      t,
      vault,
    ],
  );

  if (!showVaultMore && !showVaultSettings) return null;

  return (
    <div
      className={
        stacked
          ? "flex h-full flex-col items-center justify-between text-on-surface-variant"
          : "flex items-center gap-1 text-on-surface-variant"
      }
    >
      {showVaultMore ? (
        <DropdownMenu
          label={t("app.menu.more")}
          align="right"
          onOpen={recheckOsFolder}
          trigger={
            <IconButton
              label={t("app.menu.more")}
              {...actionBtnProps}
              disabled={controls.moreMenuBlocked && !closeNowOffered && !deleteNowOffered}
            >
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
            <IconButton
              label={t("action.settings")}
              {...actionBtnProps}
              disabled={controls.settingsGearBlocked}
            >
              <Icon name="settings" size={actionIconSize} />
            </IconButton>
          }
          items={settingsItems}
        />
      ) : null}
      <Toast toast={toast} onDismiss={dismiss} />
    </div>
  );
}
