import { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  DATA_FOLDER_LIST,
  dataFolderStatusLine,
  selectionHere,
  type FolderRow,
  type HereDevice,
} from "@upriv/shared";
import { DeviceNamesProvider, useDeviceInfo, type DataFolderListDraft } from "@upriv/shared/react";
import { FolderList, StatusLine, shownPath } from "@/components/folder-list";
import { Button } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { isAndroidDocumentsDefaultGrant } from "@/platform/native/documentsGrant";
import { useDeviceService, useVaultRootService } from "@/platform/services";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import { VaultRootIncompleteReplacePanel } from "./VaultRootIncompleteReplacePanel";

/** Default on a phone: Documents/Upriv, whatever the grant behind it is called. */
const DEFAULT_FOLDER = "Documents/Upriv";

interface DataFolderListSectionProps {
  list: DataFolderListDraft;
  here: HereDevice | null;
  /** The data folder in use wears In use, and deleting its row asks first. Setup has none. */
  showInUse: boolean;
  /** The window's own work runs: nothing changes meanwhile. */
  disabled: boolean;
  /** Another option of the window is chosen: no choice of the list shows chosen. */
  noneChecked?: boolean;
  /** Any edit of the list or of the replace choice. */
  onEdit?: () => void;
}

/**
 * The data folder list as Setup and the Data folder window show it on a
 * phone: this device's picked folders with Default (Documents/Upriv) below
 * them, each with its status, the other devices, the step the selected
 * folder still misses, and the replace choice for a broken `.upriv/`.
 */
export function DataFolderListSection({
  list,
  here,
  showInUse,
  disabled,
  noneChecked = false,
  onEdit,
}: DataFolderListSectionProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const vaultRoot = useVaultRootService();
  const device = useDeviceInfo(useDeviceService());
  const { view, loadError, gate } = list;

  const pickFolder = useCallback(
    () => vaultRoot.pickFolder(null, t("modal.vault_root_setup.pick_folder_title")),
    [t, vaultRoot],
  );

  if (loadError && !view) {
    return (
      <View style={styles.problem}>
        <Text
          accessibilityRole="alert"
          style={[typography.body, { color: colors.onErrorContainer }]}
        >
          {t(mobileErrorI18nKey(loadError, "modal.vault_root_setup.error_io"))}
        </Text>
        <Button label={t("action.retry")} variant="secondary" size="sm" onPress={list.reload} />
      </View>
    );
  }
  if (!view) {
    return <Text style={typography.bodyMuted}>{t("modal.data_folder.loading")}</Text>;
  }

  const hereId = here?.id ?? null;
  const inUse =
    showInUse && !view.explicit ? selectionHere(list.saved, hereId, DATA_FOLDER_LIST) : null;
  const selectedRow =
    typeof list.selection === "number"
      ? (list.draft[hereId ?? ""]?.rows.find((row) => row.number === list.selection) ?? null)
      : null;
  const selectedFolder =
    list.selection === "default"
      ? DEFAULT_FOLDER
      : selectedRow
        ? shownPath(selectedRow.path)
        : null;
  const confirmDelete = (row: FolderRow) =>
    inUse === row.number ? t("modal.data_folder.delete_in_use") : null;
  // A phone checks Default only while it is the data folder, or nothing is; a
  // check that failed says so.
  const defaultStatus =
    list.defaultStatus &&
    (list.defaultStatus.content !== null || list.defaultStatus.state !== "ok") ? (
      <StatusLine line={dataFolderStatusLine(list.defaultStatus, t)} />
    ) : null;
  // What the chosen folder still needs, inside its card under the status that
  // names the problem (desktop parity): Retry for a folder whose check
  // failed, or the choice for a broken `.upriv`. A path the rules refuse says
  // why on its row, and checking it again changes nothing.
  const retryable = gate.problem !== undefined && gate.problem !== "folder_list.status.refused";
  const selectedFooter = noneChecked ? null : retryable ? (
    <Button
      label={t("action.retry")}
      variant="secondary"
      size="sm"
      disabled={disabled}
      onPress={list.retryStatuses}
      style={styles.retry}
    />
  ) : gate.needsReplacePolicy && selectedFolder ? (
    <VaultRootIncompleteReplacePanel
      folder={selectedFolder}
      replacePolicy={list.replacePolicy}
      disabled={disabled}
      onReplacePolicyChange={(policy) => {
        list.setReplacePolicy(policy);
        onEdit?.();
      }}
    />
  ) : null;

  return (
    <View style={styles.wrap}>
      {view.explicit ? (
        <Text style={typography.caption}>
          {t("modal.vault_root_setup.env_override", { path: view.explicit })}
        </Text>
      ) : null}
      {/* The list file names its own devices. */}
      <DeviceNamesProvider names={view.osNames} here={device}>
        <FolderList
          label={t("modal.data_folder.list_label")}
          policy={DATA_FOLDER_LIST}
          groups={list.draft}
          saved={list.saved}
          here={here}
          fixed={[
            {
              choice: "default",
              title: t("folder_list.choice.default"),
              description: t("folder_list.choice.default_desc_android"),
              status: defaultStatus,
            },
          ]}
          disabled={disabled}
          noneChecked={noneChecked}
          renderStatus={(path) => (
            <StatusLine line={dataFolderStatusLine(list.rowStatus(path), t)} />
          )}
          selectionAttention={gate.attention}
          selectedFooter={selectedFooter}
          inUse={inUse}
          confirmDelete={confirmDelete}
          pickFolder={pickFolder}
          pickedChoice={(picked) => (isAndroidDocumentsDefaultGrant(picked) ? "default" : null)}
          onChange={(groups) => {
            list.setDraft(groups);
            onEdit?.();
          }}
        />
      </DeviceNamesProvider>
      {!noneChecked && list.selection === "default" && list.defaultStatus?.content === "empty" ? (
        <Text style={typography.caption}>{t("modal.data_folder.android_documents_note")}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  problem: { gap: spacing.sm },
  retry: { alignSelf: "flex-start" },
});
