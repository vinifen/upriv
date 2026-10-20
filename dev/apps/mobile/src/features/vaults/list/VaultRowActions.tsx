import { useCallback, useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { useToast } from "@upriv/shared/react";
import {
  currentWorkspaceSystem,
  osFileManagerFolderEnabled,
  peekVaultSettings,
  isVaultListRowUnlockTarget,
  resolveVaultListStatus,
  storageModeIsPlaintext,
  vaultCanExport,
  VAULT_SETTINGS_AREA_ICON,
  VAULT_SETTINGS_AREA_I18N,
  vaultRowControls,
  vaultSettingsMenuAreas,
  type VaultListItem,
  type VaultSettingsAreaId,
  type WorkspaceTable,
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
  onExportVault: (vault: VaultListItem) => void;
  onOpenFileManager: (vault: VaultListItem) => void;
  onLockVault: (vault: VaultListItem) => void;
  onUnlockVault: (vault: VaultListItem) => void;
  /** Block cards: stack ⋯ / settings to the right of the title. */
  layout?: "row" | "column";
}

export function VaultRowActions({
  vault,
  pipelineListStatus,
  includeLockAction = false,
  onOpenBackups,
  onOpenNote,
  onOpenVaultInfo,
  onOpenSettings,
  onExportVault,
  onOpenFileManager,
  onLockVault,
  onUnlockVault,
  layout = "row",
}: VaultRowActionsProps) {
  const { t } = useTranslation();
  const { settings } = useAppSettingsContext();
  const vaultService = useVaultService();
  const fs = useVaultFileSystemService();
  const { toast, show, dismiss } = useToast();
  const openOsMount = useCallback(() => {
    void fs
      .osPath(vault.id, "/")
      .then((osPath) => {
        if (!osPath) {
          show(t("error.vault_mount_failed"));
          return;
        }
        return revealInOsFileManager(osPath);
      })
      .catch((error: unknown) => {
        show(t(mobileErrorI18nKey(error, "modal.file_manager.toast.open_system_failed")));
      });
  }, [fs, show, t, vault.id]);
  const showVaultMore = settings.ui.vault_list_show_vault_more_button !== false;
  const showVaultSettings = settings.ui.vault_list_show_vault_settings_button !== false;
  const listStatus = resolveVaultListStatus(vault, pipelineListStatus);
  const isOpen = listStatus === "open";
  const canUnlock = isVaultListRowUnlockTarget(listStatus);
  const canUseOpenWorkspace = listStatus === "open";
  const plaintext = storageModeIsPlaintext(vault.storageMode);
  const rememberedMount = peekVaultSettings(vault.id)?.mount;
  const [fetchedMount, setFetchedMount] = useState<WorkspaceTable | undefined>(rememberedMount);
  useEffect(() => {
    if (!canUseOpenWorkspace || plaintext) return;
    if (rememberedMount) {
      setFetchedMount(rememberedMount);
      return;
    }
    let cancelled = false;
    void vaultService.getSettings(vault.id).then(
      (next) => {
        if (!cancelled) setFetchedMount(next?.mount);
      },
      () => {
        if (!cancelled) setFetchedMount(undefined);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [canUseOpenWorkspace, plaintext, rememberedMount, vault.id, vaultService]);
  const showOsFileManager =
    canUseOpenWorkspace &&
    osFileManagerFolderEnabled(
      plaintext,
      settings.workspace,
      rememberedMount ?? fetchedMount,
      currentWorkspaceSystem(Platform.OS),
    );
  const canExport = vaultService.canExportVault && vaultCanExport(vault, pipelineListStatus);
  const controls = vaultRowControls(vault, pipelineListStatus);

  const stacked = layout === "column";
  const iconStyle = stacked ? columnIconStyle : rowIconStyle;
  const iconSize = stacked ? 18 : 20;

  if (!showVaultMore && !showVaultSettings) return null;

  return (
    <View
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
              disabled={controls.moreMenuBlocked}
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
                  label={t("action.open_file_manager")}
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
          {vaultSettingsMenuAreas(vault, pipelineListStatus).map((area) => (
            <MenuActionItem
              key={area}
              icon={VAULT_SETTINGS_AREA_ICON[area]}
              label={t(VAULT_SETTINGS_AREA_I18N[area])}
              disabled={controls.settingsGearBlocked}
              onPress={() => onOpenSettings(vault, area)}
            />
          ))}
        </DropdownPanel>
      ) : null}
      <FloatingToast toast={toast} onDismiss={dismiss} />
    </View>
  );
}
