import { useCallback, useEffect, useState } from "react";
import {
  DATA_FOLDER_LIST,
  dataFolderStatusLine,
  selectionHere,
  type AppDistribution,
  type FolderRow,
  type HereDevice,
} from "@upriv/shared";
import { DeviceNamesProvider, useDeviceInfo, type DataFolderListDraft } from "@upriv/shared/react";
import { FolderList, StatusLine } from "@/components/folder-list";
import { Button } from "@/components/ui";
import { useTranslation, type I18nKey } from "@/i18n";
import { getAppVersion, getSessionAppVersion } from "@/lib/appVersion";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import { useDeviceService, useVaultRootService } from "@/platform/services";
import { VaultRootIncompleteReplacePanel } from "./VaultRootIncompleteReplacePanel";

const DEFAULT_DESC_KEYS: Record<AppDistribution, I18nKey> = {
  portable: "folder_list.choice.default_desc_portable",
  installed: "folder_list.choice.default_desc_installed",
  dev: "folder_list.choice.default_desc_dev",
};

interface DataFolderListSectionProps {
  list: DataFolderListDraft;
  here: HereDevice | null;
  /** The data folder in use wears In use, and deleting its row asks first. Setup has none. */
  showInUse: boolean;
  /** The window's own work runs: nothing changes meanwhile. */
  disabled: boolean;
  /** Another option of the window is chosen: no radio of the list shows checked. */
  noneChecked?: boolean;
  /** Any edit of the list or of the replace choice. */
  onEdit?: () => void;
}

/**
 * The data folder list as Setup, Repair, and the Data folder window show it:
 * Default above this device's rows, each with its status, the
 * other devices, the step the selected folder still misses, and the replace
 * choice for a broken `.upriv/`.
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
  const vaultRoot = useVaultRootService();
  const device = useDeviceInfo(useDeviceService());
  const [pickStart, setPickStart] = useState<string | null>(null);
  const [distribution, setDistribution] = useState<AppDistribution>(
    () => getSessionAppVersion()?.distribution ?? "portable",
  );
  const { view, loadError, gate } = list;

  useEffect(() => {
    let current = true;
    void getAppVersion().then((info) => {
      if (current && info.distribution) setDistribution(info.distribution);
    });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    void vaultRoot.suggestedCustomRootPath().then(
      (path) => {
        if (current) setPickStart(path || null);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [vaultRoot]);

  const pickFolder = useCallback(
    (start: string | null) =>
      vaultRoot.pickFolder(start, t("modal.vault_root_setup.pick_folder_title")),
    [t, vaultRoot],
  );

  if (loadError && !view) {
    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p
          className="rounded-md bg-error-container/10 px-3 py-2 text-xs leading-relaxed text-on-error-container"
          role="alert"
        >
          {t(desktopErrorI18nKey(loadError, "modal.vault_root_setup.error_io"))}
        </p>
        <Button
          type="button"
          variant="secondary"
          size="md"
          className="w-full shrink-0 sm:w-auto"
          onClick={list.reload}
        >
          {t("action.retry")}
        </Button>
      </div>
    );
  }
  if (!view) {
    return (
      <p className="text-xs leading-relaxed text-on-surface-variant" role="status">
        {t("modal.data_folder.loading")}
      </p>
    );
  }

  const hereId = here?.id ?? null;
  const inUse =
    showInUse && !view.explicit ? selectionHere(list.saved, hereId, DATA_FOLDER_LIST) : null;
  const selectedFolder =
    list.selection === "default"
      ? view.defaultFolder
      : typeof list.selection === "number"
        ? (list.draft[hereId ?? ""]?.rows.find((row) => row.number === list.selection)?.path ??
          null)
        : null;
  const confirmDelete = (row: FolderRow) =>
    inUse === row.number ? t("modal.data_folder.delete_in_use") : null;
  // What the chosen folder still needs, inside its card under the status that
  // names the problem: Retry for a folder whose check failed, or the choice
  // for a broken `.upriv`. A path the rules refuse says why on its row, and
  // checking it again changes nothing.
  const retryable = gate.problem !== undefined && gate.problem !== "folder_list.status.refused";
  const selectedFooter = noneChecked ? null : retryable ? (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={disabled}
      onClick={list.retryStatuses}
    >
      {t("action.retry")}
    </Button>
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
    <div className="space-y-3">
      {view.explicit ? (
        <p
          className="rounded-md bg-surface-container px-3 py-2 text-xs leading-relaxed text-on-surface"
          role="status"
        >
          {t("modal.vault_root_setup.env_override", { path: view.explicit })}
        </p>
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
              description: t(DEFAULT_DESC_KEYS[distribution]),
              folder: view.defaultFolder,
              status: <StatusLine line={dataFolderStatusLine(list.defaultStatus, t)} />,
            },
          ]}
          fixedFolders={list.fixedHere}
          disabled={disabled}
          noneChecked={noneChecked}
          renderStatus={(path) => (
            <StatusLine line={dataFolderStatusLine(list.rowStatus(path), t)} />
          )}
          selectionAttention={gate.attention}
          selectedFooter={selectedFooter}
          inUse={inUse}
          confirmDelete={confirmDelete}
          pickStart={pickStart}
          pickFolder={pickFolder}
          onChange={(groups) => {
            list.setDraft(groups);
            onEdit?.();
          }}
        />
      </DeviceNamesProvider>
    </div>
  );
}
