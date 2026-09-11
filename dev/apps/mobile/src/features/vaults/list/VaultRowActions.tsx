import { View } from "react-native";
import {
  resolveVaultDisplayStatus,
  vaultCanExport,
  VAULT_SETTINGS_AREA_ICON,
  VAULT_SETTINGS_AREA_I18N,
  VAULT_SETTINGS_AREAS,
  type VaultListItem,
  type VaultSettingsAreaId,
} from "@upriv/shared";
import { DropdownPanel, IconButton, MenuActionItem } from "@/components/ui";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation } from "@/i18n";
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
  pipelineListStatus?: {
    openingVaultIds?: readonly string[];
    closingVaultIds?: readonly string[];
  };
  disabled?: boolean;
  includeLockAction?: boolean;
  onOpenBackups: (vault: VaultListItem) => void;
  onOpenNote: (vault: VaultListItem) => void;
  onOpenVaultInfo: (vault: VaultListItem) => void;
  onOpenSettings: (vault: VaultListItem, area: VaultSettingsAreaId) => void;
  onExportVault: (vault: VaultListItem) => void;
  onOpenFileManager: (vault: VaultListItem) => void;
  onOpenFolder: (vault: VaultListItem) => void;
  onLockVault: (vault: VaultListItem) => void;
  onUnlockVault: (vault: VaultListItem) => void;
  /** Block cards: stack ⋯ / settings to the right of the title. */
  layout?: "row" | "column";
}

export function VaultRowActions({
  vault,
  pipelineListStatus,
  disabled = false,
  includeLockAction = false,
  onOpenBackups,
  onOpenNote,
  onOpenVaultInfo,
  onOpenSettings,
  onExportVault,
  onOpenFileManager,
  onOpenFolder,
  onLockVault,
  onUnlockVault,
  layout = "row",
}: VaultRowActionsProps) {
  const { t } = useTranslation();
  const { settings } = useAppSettingsContext();
  const showVaultMore = settings.ui.vault_list_show_vault_more_button !== false;
  const showVaultSettings = settings.ui.vault_list_show_vault_settings_button !== false;
  const isOpen = resolveVaultDisplayStatus(vault) === "open";
  const canExport = vaultCanExport(vault, pipelineListStatus);

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
              disabled={disabled}
              style={iconStyle}
            />
          }
        >
          {includeLockAction ? (
            <MenuActionItem
              icon={isOpen ? "lock" : "lock-open"}
              label={isOpen ? t("action.lock") : t("action.unlock")}
              disabled={disabled}
              onPress={() => (isOpen ? onLockVault(vault) : onUnlockVault(vault))}
            />
          ) : null}
          {isOpen ? (
            <>
              <MenuActionItem
                icon="file-manager"
                label={t("action.open_upriv")}
                disabled={disabled}
                onPress={() => onOpenFileManager(vault)}
              />
              <MenuActionItem
                icon="folder"
                label={t("action.open_folder")}
                disabled={disabled}
                onPress={() => onOpenFolder(vault)}
              />
            </>
          ) : null}
          {canExport ? (
            <MenuActionItem
              icon="download"
              label={t("action.export_vault")}
              disabled={disabled}
              onPress={() => onExportVault(vault)}
            />
          ) : null}
          <MenuActionItem
            icon="archive"
            label={t("action.backups")}
            disabled={disabled}
            onPress={() => onOpenBackups(vault)}
          />
          <MenuActionItem
            icon="note"
            label={t("action.note")}
            disabled={disabled}
            onPress={() => onOpenNote(vault)}
          />
          <MenuActionItem
            icon="info"
            label={t("action.vault_info")}
            disabled={disabled}
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
              disabled={disabled}
              style={iconStyle}
            />
          }
        >
          {VAULT_SETTINGS_AREAS.map((area) => (
            <MenuActionItem
              key={area}
              icon={VAULT_SETTINGS_AREA_ICON[area]}
              label={t(VAULT_SETTINGS_AREA_I18N[area])}
              disabled={disabled}
              onPress={() => onOpenSettings(vault, area)}
            />
          ))}
        </DropdownPanel>
      ) : null}
    </View>
  );
}
