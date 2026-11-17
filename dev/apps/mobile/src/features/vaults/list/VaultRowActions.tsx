import { useCallback } from "react";
import { View } from "react-native";
import { useOsFolderReady, useToast } from "@upriv/shared/react";
import {
  isVaultListRowUnlockTarget,
  resolveVaultListStatus,
  storageModeIsPlaintext,
  vaultCloseNowOffered,
  vaultDeleteNowOffered,
  vaultExportMenuShown,
  VAULT_SETTINGS_MENU_ICON,
  VAULT_SETTINGS_MENU_I18N,
  vaultRowControls,
  vaultSettingsMenuEntries,
  type VaultListItem,
  type VaultSettingsAreaId,
} from "@upriv/shared";
import { DropdownPanel, FloatingToast, IconButton, MenuActionItem } from "@/components/ui";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { revealInOsFileManager } from "@/lib/revealInFileManager";
import { useVaultFileSystemService, useVaultService } from "@/platform/services";
import { radii } from "@/theme/tokens";

const rowIconStyle = {
  width: 44,
  height: 44,
  minWidth: 44,
  minHeight: 44,
  borderRadius: radii.md,
  padding: 0,
};

const columnIconStyle = {
  width: 36,
  height: 36,
  minWidth: 36,
  minHeight: 36,
  borderRadius: radii.md,
  padding: 0,
};

interface VaultRowActionsProps {
  vault: VaultListItem;
  pipelineListStatus?: import("@upriv/shared").VaultPipelineListStatus;
  includeLockAction?: boolean;
  onOpenBackups: (vault: VaultListItem) => void;
  onOpenNote: (vault: VaultListItem) => void;
  onOpenVaultInfo: (vault: VaultListItem) => void;
  onOpenSettings: (vault: VaultListItem, area: VaultSettingsAreaId) => void;
  /** The Delete vault window, the last entry of the Settings menu. */
  onOpenDelete: (vault: VaultListItem) => void;
  onExportVault: (vault: VaultListItem) => void;
  onOpenFileManager: (vault: VaultListItem) => void;
  onLockVault: (vault: VaultListItem) => void;
  onUnlockVault: (vault: VaultListItem) => void;
  onCloseNow: (vault: VaultListItem) => void;
  /** Continue (`now` false) or Delete now (`now` true) for a vault being deleted. */
  onDeleteWork: (vault: VaultListItem, now: boolean) => void;
  /** Block cards: stack ⋯ / settings to the right of the title. */
  layout?: "row" | "column";
  /** A touch on these buttons, before the row sees it. */
  onTouchStart?: () => void;
}

export function VaultRowActions({
  vault,
  pipelineListStatus,
  includeLockAction = false,
  onOpenBackups,
  onOpenNote,
  onOpenVaultInfo,
  onOpenSettings,
  onOpenDelete,
  onExportVault,
  onOpenFileManager,
  onLockVault,
  onUnlockVault,
  onCloseNow,
  onDeleteWork,
  layout = "row",
  onTouchStart,
}: VaultRowActionsProps) {
  const { t } = useTranslation();
  const { settings } = useAppSettingsContext();
  const vaultService = useVaultService();
  const fs = useVaultFileSystemService();
  const { toast, show, dismiss } = useToast();
  const showVaultMore = settings.ui.vault_list_show_vault_more_button !== false;
  const showVaultSettings = settings.ui.vault_list_show_vault_settings_button !== false;
  const listStatus = resolveVaultListStatus(vault, pipelineListStatus);
  const isOpen = listStatus === "open";
  const canUnlock = isVaultListRowUnlockTarget(listStatus);
  const canUseOpenWorkspace = listStatus === "open";
  // A phone mounts no encrypted vault's folder: only a plain-text vault has
  // one, and Open unlocked folder shows only while core says it is there.
  const osFolder = useOsFolderReady(
    (vaultId, path) => fs.osPath(vaultId, path),
    vault.id,
    canUseOpenWorkspace && storageModeIsPlaintext(vault.storageMode),
  );
  const showOsFileManager = canUseOpenWorkspace && osFolder.ready;
  const { recheck: recheckOsFolder } = osFolder;
  /** Reveal the vault's folder in the Files app. A folder gone meanwhile only hides the item. */
  const openOsMount = useCallback(() => {
    void fs
      .osPath(vault.id, "/")
      .then((answer) => {
        if (answer.state === "ready") return revealInOsFileManager(answer.osPath);
        recheckOsFolder();
      })
      .catch((error: unknown) => {
        show(t(mobileErrorI18nKey(error, "modal.file_manager.toast.open_system_failed")));
      });
  }, [fs, recheckOsFolder, show, t, vault.id]);
  const canExport = vaultService.canExportVault && vaultExportMenuShown(vault, pipelineListStatus);
  const controls = vaultRowControls(vault, pipelineListStatus);
  const closeNowOffered = vaultCloseNowOffered(listStatus, vault.id, pipelineListStatus);
  const deleteNowOffered = vaultDeleteNowOffered(listStatus, vault.id, pipelineListStatus);

  const stacked = layout === "column";
  const iconStyle = stacked ? columnIconStyle : rowIconStyle;
  const iconSize = stacked ? 18 : 20;

  if (!showVaultMore && !showVaultSettings) return null;

  return (
    <View
      onTouchStart={onTouchStart}
      style={{
        flexDirection: stacked ? "column" : "row",
        alignItems: "center",
        justifyContent: stacked ? "space-between" : "center",
        alignSelf: stacked ? "stretch" : undefined,
        gap: stacked ? 0 : 4,
      }}
    >
      {showVaultMore ? (
        <DropdownPanel
          label={t("app.menu.more")}
          heading={t("app.menu.more")}
          align="right"
          minWidth={220}
          trigger={
            <IconButton
              label={t("app.menu.more")}
              icon="more-horizontal"
              size={iconSize}
              disabled={controls.moreMenuBlocked && !closeNowOffered && !deleteNowOffered}
              style={iconStyle}
            />
          }
        >
          {includeLockAction && (isOpen || canUnlock) ? (
            <MenuActionItem
              icon={isOpen ? "lock" : "lock-open"}
              label={isOpen ? t("action.lock") : t("action.unlock")}
              disabled={controls.moreMenuBlocked}
              onPress={() => (isOpen ? onLockVault(vault) : onUnlockVault(vault))}
            />
          ) : null}
          {canUseOpenWorkspace ? (
            <>
              <MenuActionItem
                icon="file-manager"
                label={t("action.open_upriv")}
                disabled={controls.moreMenuBlocked}
                onPress={() => onOpenFileManager(vault)}
              />
              {showOsFileManager ? (
                <MenuActionItem
                  icon="folder"
                  label={t("action.open_unlocked_folder")}
                  disabled={controls.moreMenuBlocked}
                  onPress={openOsMount}
                />
              ) : null}
            </>
          ) : null}
          {canExport ? (
            <MenuActionItem
              icon="download"
              label={t("action.export_vault")}
              disabled={controls.moreMenuBlocked}
              onPress={() => onExportVault(vault)}
            />
          ) : null}
          <MenuActionItem
            icon="archive"
            label={t("action.backups")}
            disabled={controls.moreMenuBlocked}
            onPress={() => onOpenBackups(vault)}
          />
          {controls.noteHidden ? null : (
            <MenuActionItem
              icon="note"
              label={t("action.note")}
              disabled={controls.noteBlocked}
              onPress={() => onOpenNote(vault)}
            />
          )}
          {isOpen || closeNowOffered ? (
            <MenuActionItem
              icon="lock"
              label={t("action.close_now")}
              onPress={() => onCloseNow(vault)}
            />
          ) : null}
          {deleteNowOffered ? (
            <MenuActionItem
              icon="trash"
              label={t("action.delete_now")}
              onPress={() => onDeleteWork(vault, true)}
            />
          ) : null}
          <MenuActionItem
            icon="info"
            label={t("action.vault_info")}
            disabled={controls.moreMenuBlocked}
            onPress={() => onOpenVaultInfo(vault)}
          />
        </DropdownPanel>
      ) : null}
      {showVaultSettings ? (
        <DropdownPanel
          label={t("action.settings")}
          heading={t("action.settings")}
          align="right"
          minWidth={220}
          trigger={
            <IconButton
              label={t("action.settings")}
              icon="settings"
              size={iconSize}
              disabled={controls.settingsGearBlocked}
              style={iconStyle}
            />
          }
        >
          {vaultSettingsMenuEntries(vault, pipelineListStatus).map((entry) => (
            <MenuActionItem
              key={entry}
              icon={VAULT_SETTINGS_MENU_ICON[entry]}
              label={t(VAULT_SETTINGS_MENU_I18N[entry])}
              danger={entry === "delete"}
              disabled={controls.settingsGearBlocked}
              onPress={() =>
                entry === "delete" ? onOpenDelete(vault) : onOpenSettings(vault, entry)
              }
            />
          ))}
        </DropdownPanel>
      ) : null}
      <FloatingToast toast={toast} onDismiss={dismiss} />
    </View>
  );
}
